const { GST_RATE } = require('../utils/revenueHelpers');

function calculateTaxSummary(totalRevenue, planBreakdown = {}) {
  const taxableRevenue = Math.max(0, Number(totalRevenue || 0));
  const gstCollected = Math.round(taxableRevenue * GST_RATE);

  return {
    totalRevenue: taxableRevenue,
    taxableRevenue,
    gstRate: GST_RATE * 100,
    gstCollected,
    netRevenue: Math.max(0, taxableRevenue - gstCollected),
    invoiceCount: Object.values(planBreakdown).reduce((sum, p) => sum + (p.count || 0), 0),
    planBreakdown,
  };
}

module.exports = { calculateTaxSummary };
