# Proxmox VE GPU Passthrough for HAL

Pass a physical NVIDIA card through to the VM that runs HAL, so Ollama gets
near-native GPU access.

Passthrough is **exclusive**: the host loses the card entirely, and exactly one
VM can hold it at a time. Plan for that before you start — especially if it's
your only GPU.

**Verified against:** Proxmox VE **9.1.1** (kernel 6.17.2-1-pve), Tesla
V100-SXM2-32GB, Ubuntu 24.04 guest. Steps marked *(verified)* are what the
reference deployment actually runs, not what the internet recommends.

---

## 1. Prerequisites

**Hardware**

- **CPU with IOMMU** — Intel VT-d or AMD-Vi. Any Xeon, EPYC, or mainstream
  desktop CPU from the last decade; some low-end SKUs omit it.
- **A motherboard that exposes the IOMMU setting.** Server boards always do;
  consumer boards usually do, sometimes buried.
- **A GPU you can dedicate entirely to the VM.** Datacenter cards (Tesla,
  A-series) are the easiest — no display outputs, no audio function, no
  consumer-driver lockouts.

**BIOS/UEFI, before touching Proxmox**

- **Intel:** enable `VT-d` (often under *Advanced → Chipset* or *IIO
  Configuration*), plus `VT-x`.
- **AMD:** enable `IOMMU` (often under *AMD CBS* or *NBIO options*), plus `SVM`.
- **Above 4G Decoding** — required for large-BAR cards, which includes most
  datacenter GPUs. If the VM later fails to start with BAR mapping errors, this
  is usually why.
- If the GPU is also your boot/display card, point the BIOS primary display at
  an iGPU or another card if you can.

---

## 2. Enable IOMMU on the host

Most Proxmox installs boot via GRUB. Edit `/etc/default/grub`:

```bash
# Intel:
GRUB_CMDLINE_LINUX_DEFAULT="quiet intel_iommu=on iommu=pt"

# AMD:
GRUB_CMDLINE_LINUX_DEFAULT="quiet amd_iommu=on iommu=pt"
```

`iommu=pt` puts devices you are *not* passing through into passthrough mode,
avoiding a small translation overhead on the rest of the system.

```bash
update-grub
reboot
```

**ZFS-root hosts boot via `systemd-boot` instead** — put the same options in
`/etc/kernel/cmdline` and run `proxmox-boot-tool refresh`. Quick way to tell
which you have: if `proxmox-boot-tool status` errors with
`/etc/kernel/proxmox-boot-uuids does not exist`, you're on GRUB. *(verified —
the reference host is GRUB + LVM root, and is exactly this case.)*

Verify after the reboot:

```bash
cat /proc/cmdline                 # your options should be there
dmesg | grep -e DMAR -e IOMMU     # want "DMAR: IOMMU enabled" / "AMD-Vi: ..."
```

---

## 3. Bind the GPU to vfio-pci

### Find the vendor:device ID

```bash
lspci -nn | grep -i nvidia
```

```
81:00.0 3D controller [0302]: NVIDIA Corporation GV100GL [Tesla V100 SXM2 32GB] [10de:1db5] (rev a1)
```

The ID is the `[10de:xxxx]` part — here `10de:1db5`. Consumer GeForce cards
also have an audio function (`81:00.1 Audio device`); note both IDs. Datacenter
Teslas have no audio function *(verified — the V100 is a single function)*.

### Claim the card before the host drivers can

```bash
cat > /etc/modprobe.d/vfio.conf <<'EOF'
options vfio-pci ids=10de:1db5
softdep nouveau pre: vfio-pci
softdep nvidiafb pre: vfio-pci
EOF

cat > /etc/modprobe.d/blacklist-nouveau.conf <<'EOF'
blacklist nouveau
blacklist nvidiafb
EOF
```

*(verified — this exact pair of files is what the reference host runs.)*

Two IDs, comma-separated, for a card with an audio function:
`options vfio-pci ids=10de:2204,10de:1aef`

**The `softdep` lines are the part most guides omit, and they're the ones that
make this reliable.** Blacklisting alone is a race: it stops the module from
autoloading, but anything that pulls `nouveau` in explicitly still beats
`vfio-pci` to the card. `softdep ... pre: vfio-pci` forces vfio-pci to load
*first* in that case, so the card is already claimed. Keep both mechanisms.

Apply and reboot:

```bash
update-initramfs -u -k all
reboot
```

### You probably do NOT need `/etc/modules`

Most guides tell you to add `vfio`, `vfio_iommu_type1`, and `vfio_pci` to
`/etc/modules`. On **PVE 8 and 9 this is unnecessary** — the VM start-up path
loads the vfio modules on demand.

*(verified — on the reference host `/etc/modules` contains nothing but Debian's
"this file is obsolete" comment, and passthrough has worked across three GPU
hand-offs.)* Adding them is harmless if you prefer belt-and-braces; just don't
assume passthrough is broken because you skipped it.

### Confirm the binding

```bash
lspci -nnk -d 10de:
```

```
81:00.0 3D controller [0302]: NVIDIA Corporation GV100GL [Tesla V100 SXM2 32GB] [10de:1db5]
        Kernel driver in use: vfio-pci
        Kernel modules: nvidiafb, nouveau
```

`Kernel driver in use: vfio-pci` is the line that matters. Seeing `nvidiafb,
nouveau` on the *Kernel modules* line is normal and not a problem — that lists
what *could* drive the card, not what does.

If it still says `nouveau`, the config didn't take: re-run
`update-initramfs -u -k all`, check for typos in the ID, and confirm the files
are in `/etc/modprobe.d/` with a `.conf` extension.

---

## 4. Check the IOMMU group

Passthrough works at **group granularity**: every device in the GPU's group goes
to the VM together, or none do.

```bash
for d in /sys/kernel/iommu_groups/*/devices/*; do
  echo "group $(echo "$d" | cut -d/ -f5): $(basename "$d") $(lspci -s "$(basename "$d")" | cut -d' ' -f2-)"
done | sort -V | grep -i nvidia
```

On the reference host the V100 is alone in group 11 *(verified)* — which is the
normal outcome for a CPU-attached slot on a server board.

**If your GPU shares a group with other devices**, in order of preference:

1. **Move the card to a different slot.** CPU-attached slots usually get clean
   groups; chipset-attached slots often share.
2. **Pass the whole group through.** Fine if it's just the GPU's own functions.
   Not fine if your boot NVMe is in there.
3. **ACS override** (`pcie_acs_override=downstream,multifunction` on the kernel
   cmdline) — last resort. It does not improve isolation; it *tells the kernel
   to assume* isolation the hardware may not provide. Devices that look
   separated can still do peer-to-peer DMA, which breaks the boundary between
   VMs. Common in single-user homelabs; don't do it on anything multi-tenant.

---

## 5. VM configuration

Four settings are load-bearing:

| Setting | Value | Why |
|---|---|---|
| Machine | `q35` | PCIe passthrough requires it; `i440fx` is legacy PCI only |
| BIOS | `OVMF (UEFI)` + EFI disk | Modern GPU option ROMs are UEFI |
| CPU | `host` | Exposes real AVX/AVX2/AVX-512 flags, which CPU inference uses |
| Ballooning | **off** | Passthrough pins the full guest RAM for DMA mapping |

From the shell:

```bash
qm create 150 --name halpub --machine q35 --bios ovmf --cpu host \
  --cores 16 --memory 32768 --balloon 0 --numa 1 --ostype l26 \
  --scsihw virtio-scsi-single --net0 virtio,bridge=vmbr0 --agent enabled=1

qm set 150 --efidisk0 <storage>:1,efitype=4m,pre-enrolled-keys=0
qm set 150 --hostpci0 0000:81:00,pcie=1
```

Notes:

- **`pre-enrolled-keys=0` leaves Secure Boot off**, so the NVIDIA driver
  installs in the guest without MOK enrollment. Setting it at creation time is
  much less annoying than discovering it later, when the symptom is a
  successful-looking driver install and `nvidia-smi: No devices were found`.
  *(verified — used on the reference test VM.)*
- **Omit the function suffix** (`0000:81:00`, not `...:00.0`) to pass all
  functions of the device — what you want for a GPU + audio function pair.
- **Do not set `x-vga=1` / "Primary GPU"** for a headless compute card. That's
  for using the GPU as the VM's display adapter. Keep the default virtual
  display so the Proxmox console still works.
- **Install `qemu-guest-agent` in the guest.** The VM config enables the agent,
  but cloud images don't ship the package — and without it `qm shutdown` has
  nothing to talk to, so every stop becomes a hard stop. Passthrough VMs get
  stopped and started a lot (see §7); make them shut down cleanly.
  *(verified — bit us on the reference deployment.)*
- Give the VM RAM headroom for your models, and remember all of it is pinned.

---

## 6. Inside the Ubuntu guest

```bash
lspci -nn | grep -i nvidia     # the card, on the virtual PCIe bus
sudo apt install -y ubuntu-drivers-common   # server images don't ship it
sudo ubuntu-drivers autoinstall
sudo reboot
nvidia-smi
```

`nvidia-smi` should print the card, its VRAM, temperature and a driver/CUDA
banner. That's everything Ollama needs — **do not install the CUDA toolkit**
(`nvidia-cuda-toolkit`) unless you're compiling something yourself; Ollama
bundles its own CUDA runtime.

To pick a specific driver instead: `ubuntu-drivers devices`, then e.g.
`sudo apt install nvidia-driver-580-server`.

Worth checking while you're here — a healthy passed-through card reports
`0` uncorrected ECC errors on datacenter parts:

```bash
nvidia-smi --query-gpu=name,driver_version,memory.total,temperature.gpu,ecc.errors.uncorrected.volatile.total --format=csv
```

---

## 7. Living with it: moving the card between VMs

This is the part guides skip, and it's most of the day-to-day pain.

**PCI passthrough cannot be hot-plugged.** Both the VM giving up the card and
the VM receiving it must be **stopped**. A `qm set` on a running VM writes the
config but changes nothing until the next full stop/start.

**A stopped VM that still lists `hostpci0` still owns the claim.** Two VMs
configured for the same card is not an error you get warned about — it's an
error you discover when the second one refuses to start. Always clear the
config on the old holder, don't just shut it down:

```bash
qm set <old-vmid> --delete hostpci0
```

**To find out who currently claims the card, use `qm config` — not `grep` on
`/etc/pve/qemu-server/*.conf`:**

```bash
for f in /etc/pve/qemu-server/*.conf; do
  id=$(basename "$f" .conf)
  qm config "$id" 2>/dev/null | grep -q '^hostpci0' && echo "VM $id claims a PCI device"
done
```

Two reasons the obvious `grep` is wrong, both learned the hard way:

1. `/etc/pve/qemu-server/` is **root-only**. An unprivileged grep fails with
   permission-denied, and if you've routed stderr to `/dev/null` you get an
   empty result — *indistinguishable from "the card is free."* A check whose
   failure mode is "everything is available" is worse than no check at all.
2. Those files also contain **snapshot blocks**, which carry their own copies of
   the config. Grepping the raw file reports phantom holders that don't reflect
   the live configuration. `qm config` prints only live config.

**Order of operations for a hand-off:**

```bash
qm shutdown <old-vmid> --timeout 120     # needs the guest agent
qm set <old-vmid> --delete hostpci0
qm set <new-vmid> --hostpci0 0000:81:00,pcie=1
qm start <old-vmid>                      # back up, now without the card
qm start <new-vmid>
```

---

## 8. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| GPU not visible in guest (`lspci` empty) | hostpci entry missing or wrong; machine type not `q35`; `pcie=1` without q35. Check `qm config <vmid>` and the VM's task log. |
| VM won't start, `vfio` errors in the task log | Another VM — possibly a **stopped** one — still claims the card (§7). Or the device is still owned by a host driver: re-check `lspci -nnk`. |
| Host console goes black after binding | **Expected** if the passed card was the host's only display. The host is fine; use SSH or the web UI. |
| `nvidia-smi`: "No devices were found" | Usually **Secure Boot** in OVMF refusing the unsigned module — disable it in the VM's UEFI menu, or rebuild with `pre-enrolled-keys=0`. Otherwise nouveau grabbed the card inside the guest: blacklist it there too. Check `dmesg \| grep -i nvidia`. |
| VM fails to start with BAR / memory mapping errors | **Above 4G Decoding** disabled in the host BIOS. Large-BAR datacenter cards need it. |
| Guest boots network-dead, qemu process alive, console unresponsive — on the **first cold start** after the card has sat unused | The card came up in a bad state and the guest wedged during PCIe init. A guest-level reboot won't clear it. **`qm stop <vmid>` then `qm start <vmid>`** forces a clean PCIe reset and it boots normally. *(verified — hit once on the reference deployment after the card sat idle for weeks; the fix is reliable.)* |
| "Code 43" / driver refuses to initialize | Largely historic — NVIDIA removed the VM-detection lockout in driver 465+, and datacenter cards never had it. Upgrade the driver rather than reaching for `hidden=1` hacks. |
| Passthrough works, `nvidia-smi` is healthy, but inference runs on CPU | Check `ollama ps` — the `PROCESSOR` column tells you the truth. Then read §10. |

---

## 9. Reference deployment

- **Host:** Proxmox VE 9.1.1, kernel 6.17.2-1-pve, dual Xeon E5-2687W v3
  (40 threads), 157 GB usable RAM, GRUB + LVM root.
- **Card:** Tesla V100-SXM2-32GB (SXM2 module on a PCIe carrier), alone in
  IOMMU group 11, bound to `vfio-pci`.
- **Guest:** Ubuntu 24.04, q35 + OVMF, Secure Boot off, `cpu: host`,
  ballooning off.
- The card has been handed between VMs several times using §7 with no
  reconfiguration of the host.

If you're shopping used-server hardware for a HAL box, datacenter Teslas are
the safe bet: no display outputs, no audio function, no consumer lockouts, and
32 GB of VRAM for the price of a mid-range gaming card.

---

## 10. Pre-Turing cards (Pascal / Volta) — read this

**Stock Ollama 0.30 and later dropped support for pre-Turing GPUs**, including
Pascal (sm_60 — GTX 10-series, P40, P100) and Volta (sm_70 — Tesla V100, Titan V,
Quadro GV100; only the V100 is verified by this project).

The failure mode is nasty because nothing looks broken: passthrough is fine,
`nvidia-smi` is healthy, the model loads — and inference quietly runs on the
CPU. If you have one of these cards, you need an Ollama built from source with
the older compute capabilities enabled, and you must **never upgrade via the
ollama.com installer**, which silently replaces your build with a stock binary.

See [models.md](models.md) for the build recipe and known-good model builds.
