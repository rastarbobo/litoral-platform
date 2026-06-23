#!/bin/bash
cd "$(dirname "$0")/.."
OUTFILE="/tmp/story53-diff.txt"
echo "--- diff for Story 5.3: Mobile-First Web Dashboard ---" > "$OUTFILE"
echo "" >> "$OUTFILE"
# Modified file
echo "=== Modified dashboard page ===" >> "$OUTFILE"
git diff HEAD -- "src/app/(dashboard)/dashboard/page.tsx" >> "$OUTFILE"
# Stage for staged diff
git add -A 2>/dev/null
# Dashboard files
echo "" >> "$OUTFILE"
echo "=== New campaign detail page ===" >> "$OUTFILE"
git diff --staged -- "src/app/(dashboard)/dashboard/campaign/" >> "$OUTFILE"
echo "" >> "$OUTFILE"
echo "=== New settings pages ===" >> "$OUTFILE"
git diff --staged -- "src/app/(dashboard)/dashboard/settings/" >> "$OUTFILE"
echo "" >> "$OUTFILE"
echo "=== New API routes ===" >> "$OUTFILE"
git diff --staged -- "src/app/api/dashboard/" >> "$OUTFILE"
echo "" >> "$OUTFILE"
echo "=== New components ===" >> "$OUTFILE"
git diff --staged -- "src/components/dashboard/" >> "$OUTFILE"
echo "" >> "$OUTFILE"
echo "=== New lib ===" >> "$OUTFILE"
git diff --staged -- "src/lib/dashboard/" >> "$OUTFILE"
echo "" >> "$OUTFILE"
echo "=== New store ===" >> "$OUTFILE"
git diff --staged -- "src/store/" >> "$OUTFILE"
echo "" >> "$OUTFILE"
echo "=== New tests ===" >> "$OUTFILE"
git diff --staged -- "src/tests/dashboard.test.ts" >> "$OUTFILE"
git reset HEAD 2>/dev/null
wc -l "$OUTFILE"
