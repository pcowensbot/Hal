#!/usr/bin/env python3
"""
Image generation script for HAL using Stable Diffusion 1.5
Runs on modest GPUs (2GB+ VRAM)
"""

import sys
import os
import torch
from diffusers import StableDiffusionPipeline
from datetime import datetime
import json

DEFAULT_OUTPUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "public", "generated-images")


def generate_image(prompt, output_dir=DEFAULT_OUTPUT_DIR):
    """
    Generate an image from a text prompt using Stable Diffusion 1.5

    Args:
        prompt: Text description of the image to generate
        output_dir: Directory to save the generated image

    Returns:
        dict with status and image_path or error
    """
    try:
        # Set device to GPU 0 (GTX 1050)
        device = "cuda:0"

        # Load Stable Diffusion 1.5 (lightweight, ~1.7GB)
        model_id = "runwayml/stable-diffusion-v1-5"

        # Load pipeline with memory optimizations
        pipe = StableDiffusionPipeline.from_pretrained(
            model_id,
            torch_dtype=torch.float16,  # Use half precision for less VRAM
            safety_checker=None,         # Disable safety checker to save VRAM
        )
        pipe = pipe.to(device)

        # Enable memory efficient attention
        pipe.enable_attention_slicing()

        # Generate the image
        # Using smaller resolution (512x512) for GTX 1050
        image = pipe(
            prompt,
            num_inference_steps=25,  # Fewer steps for faster generation
            guidance_scale=7.5,
            height=512,
            width=512,
        ).images[0]

        # Generate unique filename
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        filename = f"img_{timestamp}.png"
        filepath = os.path.join(output_dir, filename)

        # Save the image
        image.save(filepath)

        # Return success with relative path for web access
        return {
            "success": True,
            "image_path": f"/generated-images/{filename}",
            "full_path": filepath
        }

    except Exception as e:
        return {
            "success": False,
            "error": str(e)
        }

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"success": False, "error": "No prompt provided"}))
        sys.exit(1)

    # Get prompt from command line argument
    prompt = sys.argv[1]

    # Generate image
    result = generate_image(prompt)

    # Output JSON result
    print(json.dumps(result))
