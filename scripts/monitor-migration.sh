#!/bin/bash
# Migration Progress Monitor
# Usage: ./scripts/monitor-migration.sh

echo "🔍 Unified Collection Migration Monitor"
echo "========================================"
echo ""

# Check if migration is running
if ps aux | grep -q "[m]igrate-unified-collections"; then
    echo "✅ Migration is RUNNING"
else
    echo "⚠️  Migration process not found"
fi

echo ""
echo "📊 Latest Progress:"
echo "-------------------"
tail -20 /tmp/migration-output.log | grep "Progress:" | tail -5

echo ""
echo "📦 Latest Batches:"
echo "------------------"
tail -20 /tmp/migration-output.log | grep "Uploaded batch" | tail -3

echo ""
echo "❌ Recent Errors (if any):"
echo "--------------------------"
grep -i "error\|failed" /tmp/migration-output.log | tail -3 || echo "No errors found"

echo ""
echo "📈 Statistics:"
echo "--------------"
TOTAL_BATCHES=$(grep -c "Uploaded batch" /tmp/migration-output.log)
echo "Total batches uploaded: $TOTAL_BATCHES"
echo "Total vectors uploaded: $((TOTAL_BATCHES * 50))"

echo ""
echo "⏱️  Started: $(head -1 /tmp/migration-output.log | grep -o '[0-9][0-9]:[0-9][0-9]' | head -1 || echo 'Unknown')"
echo "🕐 Current: $(date '+%H:%M')"

echo ""
echo "💡 Quick Commands:"
echo "  Watch progress: tail -f /tmp/migration-output.log | grep Progress"
echo "  Check errors:   grep -i error /tmp/migration-output.log"
echo "  Full log:       tail -100 /tmp/migration-output.log"
