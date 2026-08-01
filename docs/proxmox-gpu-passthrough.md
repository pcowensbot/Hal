# Proxmox VE GPU Passthrough for HAL

HAL runs Ollama on the same box as its Node/Express server, and Ollama wants a
GPU. If your HAL server is a VM on Proxmox VE, you need to pass the physical
NVIDIA card through to the guest. This guide covers the full setup on
Proxmox VE 8.x with an Ubuntu 22.04/24.04 guest.

Passthrough gives the VM exclusive, near-native access to the GPU. The host
loses the card entirely — plan accordingly if it's your only GPU.

## 1. Prerequisites

Hardware requirements:

- **CPU with IOMMU support** — Intel VT-d or AMD-Vi (AMD IOMMU). Virtually all
  Xeons, EPYCs, and desktop CPUs from the last decade have it, but some
  low-end SKUs (older Pentiums/Celerons) do not.
- **Motherboard/BIOS support** — the board must expose the IOMMU option. Server
  boards almost always do; consumer boards usually do but sometimes hide it.
- **An NVIDIA GPU** you can dedicate entirely to the VM. Datacenter cards
  (Tesla, A-series) are the easiest; consumer GeForce cards work too on modern
  drivers.

BIOS/UEFI settings to enable before touching Proxmox:

- **Intel:** `VT-d` (sometimes under "Advanced > Chipset" or "IIO
  Configuration"), plus `VT-x` for virtualization generally.
- **AMD:** `IOMMU` (often under "AMD CBS" or "NBIO options"), plus `SVM`.
- Enable **Above 4G Decoding** if present — required for GPUs with large BARs
  (most datacenter cards).
- If the GPU is your boot/display card, set the BIOS primary display to the
  iGPU or another card if you can.

## 2. Enable IOMMU on the Proxmox host

Edit the kernel command line. For GRUB-booted hosts (the default on most
installs), edit `/etc/default/grub`:

```bash
# Intel:
GRUB_CMDLINE_LINUX_DEFAULT="quiet intel_iommu=on iommu=pt"

# AMD:
GRUB_CMDLINE_LINUX_DEFAULT="quiet amd_iommu=on iommu=pt"
```

Notes:

- On recent kernels `intel_iommu=on` is often already the default, but setting
  it explicitly costs nothing and removes doubt.
- `iommu=pt` (passthrough mode) skips IOMMU translation for host devices,
  which avoids a small performance hit on devices you're *not* passing through.

Apply and reboot:

```bash
update-grub
reboot
```

(If your host boots via `systemd-boot` — common on ZFS-root installs — add the
same options to `/etc/kernel/cmdline` and run `proxmox-boot-tool refresh`
instead.)

Verify after reboot:

```bash
dmesg | grep -e DMAR -e IOMMU
```

You want to see something like `DMAR: IOMMU enabled` (Intel) or
`AMD-Vi: Interrupt remapping enabled` (AMD). If there's nothing, re-check the
BIOS setting and the kernel cmdline (`cat /proc/cmdline`).

## 3. Load VFIO modules and bind the GPU

### Load the VFIO modules at boot

Add to `/etc/modules`:

```bash
cat >> /etc/modules <<'EOF'
vfio
vfio_iommu_type1
vfio_pci
EOF
```

(On kernel 6.x, `vfio_virqfd` is built into `vfio` and no longer needed as a
separate entry.)

### Blacklist host GPU drivers

Stop the host from claiming the card:

```bash
cat > /etc/modprobe.d/blacklist-gpu.conf <<'EOF'
blacklist nouveau
blacklist nvidia
blacklist nvidiafb
blacklist nvidia_drm
EOF
```

### Find the GPU's vendor:device IDs

```bash
lspci -nn | grep -i nvidia
```

Example output:

```
01:00.0 3D controller [0302]: NVIDIA Corporation GV100GL [Tesla V100 SXM2 32GB] [10de:1db5]
```

The IDs are the `[10de:xxxx]` values. If your card has an audio function
(consumer GeForce cards do — it shows as `01:00.1 Audio device`), note both
IDs. Datacenter Teslas typically have no audio function.

### Bind to vfio-pci

```bash
# Single ID (Tesla-style card):
echo "options vfio-pci ids=10de:1db5" > /etc/modprobe.d/vfio.conf

# GPU + audio function (GeForce-style card):
echo "options vfio-pci ids=10de:2204,10de:1aef" > /etc/modprobe.d/vfio.conf
```

Rebuild the initramfs and reboot:

```bash
update-initramfs -u -k all
reboot
```

Verify the binding:

```bash
lspci -nnk -d 10de:
```

Each function of the card should show:

```
Kernel driver in use: vfio-pci
```

If it still says `nouveau` or `nvidia`, the blacklist or vfio options didn't
take — re-run `update-initramfs -u -k all` and check for typos.

## 4. Check IOMMU groups

Passthrough works at IOMMU-group granularity: **every device in the GPU's
group goes to the VM together** (or not at all). Check the groups:

```bash
find /sys/kernel/iommu_groups/ -type l | sort -V
```

or, more readable:

```bash
pvesh get /nodes/$(hostname)/hardware/pci --pci-class-blacklist ""
```

Ideally your GPU (and its audio function) sits alone in its group. On server
boards with proper ACS support this is the normal case.

### If the GPU shares a group with other devices

Options, in order of preference:

1. **Move the card to a different physical slot** — slots wired directly to
   the CPU usually get clean groups; slots hanging off the chipset often share.
2. **Pass through everything in the group** — fine if it's just the GPU's own
   functions, not fine if your boot NVMe is in there.
3. **ACS override patch** — add `pcie_acs_override=downstream,multifunction`
   to the kernel cmdline. **Understand the risk before doing this:** the
   override *lies to the kernel* about isolation the hardware may not actually
   provide. Devices that appear separated can still perform peer-to-peer DMA
   to each other, which breaks the security boundary between VMs and can cause
   subtle memory corruption. For a single-user homelab many people accept
   this; for anything multi-tenant, don't.

## 5. VM configuration

Create the VM (or adjust an existing one) with:

- **Machine type:** `q35` (required for PCIe passthrough; the default `i440fx`
  only does legacy PCI).
- **BIOS:** `OVMF (UEFI)` with an EFI disk. Modern GPU option ROMs are UEFI;
  SeaBIOS passthrough is painful and mostly legacy.
- **CPU type:** `host` — exposes the real CPU flags. Ollama's inference code
  benefits from AVX/AVX2/AVX-512, which generic CPU types may mask.

Add the PCI device in the UI (**Hardware > Add > PCI Device**, tick
**All Functions** and **PCI-Express**), or from the shell:

```bash
qm set <vmid> -hostpci0 0000:01:00.0,pcie=1
```

Use your card's actual address from `lspci`. To pass all functions of the
device (GPU + audio on consumer cards), omit the function suffix — Proxmox
treats `0000:01:00` as "all functions" — or set it explicitly in the UI.
`pcie=1` presents the device on a PCIe root port instead of legacy PCI (needs
q35).

Do **not** set `x-vga=1` / "Primary GPU" for a headless compute card — that's
for passing a GPU as the VM's display adapter. For HAL you just want the card
visible as a compute device; keep the default virtual display for the console.

Give the VM enough RAM headroom for your models. Ballooning is best disabled
for VMs with passthrough devices (Proxmox pins the full RAM for DMA mapping
anyway).

## 6. Inside the Ubuntu guest

Boot the VM, confirm the card is visible, then install the driver:

```bash
lspci | grep -i nvidia          # card should appear on the virtual PCIe bus
sudo ubuntu-drivers autoinstall
sudo reboot
```

After the reboot:

```bash
nvidia-smi
```

You should see the card, its VRAM, and a driver/CUDA version banner. That's
all Ollama needs — **Ollama bundles its own CUDA runtime libraries**, so do
*not* install the CUDA toolkit (`nvidia-cuda-toolkit`) unless you're compiling
something yourself. The driver alone is sufficient.

If `ubuntu-drivers` picks a driver you don't want, list candidates with
`ubuntu-drivers devices` and install a specific one, e.g.
`sudo apt install nvidia-driver-550-server`.

## 7. Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| GPU not visible in guest (`lspci` shows nothing) | hostpci entry wrong or missing; machine type not `q35`; `pcie=1` set without q35. Check `qm config <vmid>` and the VM's task log for passthrough errors. |
| Host console goes black after vfio binding | **Expected** if the passed-through GPU was the host's only display. The host is fine — use SSH or the web UI. Serial console or an iGPU are your friends. |
| `nvidia-smi`: "No devices were found" | Driver didn't bind in the guest: check `dmesg | grep -i nvidia` in the VM. Common causes: Secure Boot in OVMF blocking the unsigned module (disable Secure Boot in the VM's UEFI menu, or enroll the MOK), or nouveau grabbing the card first (blacklist it in the guest too). |
| VM won't boot with the PCI device attached | Verify OVMF + q35 + EFI disk. Check `journalctl -u pveproxy` / task log for `vfio` errors — a device stuck in a shared IOMMU group or still owned by a host driver will fail to map. |
| Windows-style "Code 43" / driver refuses to init | Mostly historic: NVIDIA removed the VM-detection lockout in driver 465+. Datacenter cards (Tesla/A-series) never had it. If you hit it on an ancient driver, upgrade the driver; `args: -cpu host,hidden=1` hacks are rarely needed anymore. |
| VM fails to start with BAR / memory mapping errors | Large-BAR cards need **Above 4G Decoding** enabled in the host BIOS. Resizable BAR on the *host* side is generally fine to leave on; inside the guest, ReBAR is typically not exposed by OVMF — this costs nothing for compute workloads, only (marginally) for gaming passthrough. |
| Passthrough works, but inference is slow / model loads to CPU | Run `ollama ps` and check the `PROCESSOR` column; check `journalctl -u ollama` for CUDA init errors. On pre-Turing cards, see the note below — stock Ollama may have silently dropped GPU support. |

## Reference deployment

This guide is validated against a real HAL deployment: a **Tesla V100-SXM2-32GB**
(SXM2 module on a PCIe carrier board) passed through to an **Ubuntu 24.04 VM
with 16 cores and 64 GB RAM** on Proxmox VE 8.x. Datacenter Teslas are among
the easiest cards to pass through — no display outputs, no audio function, no
consumer-driver lockouts — so if you're shopping used-server-pull hardware for
a HAL box, they're a safe bet.

## A note on pre-Turing GPUs (Pascal / Volta)

Stock Ollama builds **0.30 and later dropped support for pre-Turing GPUs** —
that includes Pascal (sm_60, e.g. GTX 10-series, P40/P100) and Volta (sm_70,
e.g. Tesla V100). On those cards a stock modern Ollama will fall back to CPU
inference even though `nvidia-smi` looks perfectly healthy.

The fix is a source-built Ollama compiled with the older compute capabilities
enabled. See [docs/models.md](models.md) for the build recipe and which model
builds are known-good on these cards.
