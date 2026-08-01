#!/usr/bin/env python3
"""
Document processing script for HAL using Docling
Converts PDFs, DOCX, PPTX, XLSX to structured markdown/JSON
"""

import sys
import os
import json
import tempfile
from datetime import datetime

# GPU (V100) gives ~10× speedup for PDF layout + OCR on this venv.
# Set CUDA_VISIBLE_DEVICES='' in the caller environment to force CPU.

def process_document(input_path, output_format='markdown'):
    """
    Process a document using Docling and return structured content.

    Args:
        input_path: Path to the input document
        output_format: 'markdown' or 'json'

    Returns:
        dict with status, content, and metadata
    """
    try:
        from docling.document_converter import DocumentConverter
        from docling.datamodel.base_models import InputFormat

        # Initialize converter
        converter = DocumentConverter()

        # Convert document
        result = converter.convert(input_path)

        # Get the converted document
        doc = result.document

        # Extract content based on format
        if output_format == 'json':
            content = doc.export_to_dict()
        else:
            content = doc.export_to_markdown()

        # Extract metadata
        metadata = {
            'title': doc.name if hasattr(doc, 'name') else os.path.basename(input_path),
            'pages': len(doc.pages) if hasattr(doc, 'pages') else None,
            'format': result.input.format.name if hasattr(result.input, 'format') else 'unknown',
        }

        return {
            'success': True,
            'content': content,
            'metadata': metadata,
            'processed_at': datetime.now().isoformat()
        }

    except Exception as e:
        return {
            'success': False,
            'error': str(e),
            'error_type': type(e).__name__
        }


def main():
    """Main entry point for CLI usage."""
    if len(sys.argv) < 2:
        print(json.dumps({
            'success': False,
            'error': 'No input file provided',
            'usage': 'python process_document.py <file_path> [markdown|json]'
        }))
        sys.exit(1)

    input_path = sys.argv[1]
    output_format = sys.argv[2] if len(sys.argv) > 2 else 'markdown'

    # Validate input file exists
    if not os.path.exists(input_path):
        print(json.dumps({
            'success': False,
            'error': f'File not found: {input_path}'
        }))
        sys.exit(1)

    # Process the document
    result = process_document(input_path, output_format)

    # Output JSON result (for large content, write to file)
    if result.get('success') and len(json.dumps(result)) > 50000:
        # For large outputs, write content to temp file
        content = result['content']
        result['content'] = None
        result['content_truncated'] = True

        # Write full content to temp file
        temp_path = input_path + '.output'
        if isinstance(content, dict):
            with open(temp_path, 'w') as f:
                json.dump(content, f)
        else:
            with open(temp_path, 'w') as f:
                f.write(content)
        result['content_file'] = temp_path

    print(json.dumps(result))


if __name__ == '__main__':
    main()
