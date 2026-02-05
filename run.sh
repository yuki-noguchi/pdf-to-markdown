#!/usr/bin/env bash
set -euo pipefail

PDF="${1:?usage: run.sh input.pdf [out_dir]}"
OUT_DIR="${2:-out}"
DPI="${DPI:-250}"

PAGES_DIR="${OUT_DIR}/pages"
MD_DIR="${OUT_DIR}/md"
RESULT_MD="${OUT_DIR}/result.md"

mkdir -p "${PAGES_DIR}" "${MD_DIR}"

echo "[step 1] PDF -> PNG"
python /work/pdf2png.py "${PDF}" --out "${PAGES_DIR}" --dpi "${DPI}"

PROMPT_BASE=$'Convert the given page image into clean Markdown.\nRules:\n- Output ONLY Markdown.\n- Preserve headings and structure.\n- Use Markdown tables for tabular data.\n- If unreadable, write [UNREADABLE].\n- Add: <!-- page: N --> at the top.\n'

echo "[step 2] PNG -> Markdown (Codex)"

for img in "${PAGES_DIR}"/page-*.png; do
  base="$(basename "$img" .png)"
  page="${base#page-}"
  prompt="${PROMPT_BASE/ N / ${page} }"

  echo "  processing page ${page}"
  codex exec --image "$img" --output-last-message "${MD_DIR}/${base}.md" "$prompt"
done

echo "[step 3] merge markdown"

{
  echo "# Extracted Document"
  for md in "${MD_DIR}"/page-*.md; do
    echo
    echo "---"
    echo
    cat "$md"
  done
} > "${RESULT_MD}"

echo "[done] ${RESULT_MD}"
