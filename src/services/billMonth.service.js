const MONTHS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
];

const extractBillMonthYear = (bill) => {
  const description = String(bill?.description || '');

  const slashMatch = description.match(/\b(\d{1,2})\s*\/\s*(\d{4})\b/);
  if (slashMatch) {
    const month = Number(slashMatch[1]);
    const year = Number(slashMatch[2]);
    if (month >= 1 && month <= 12) return { month, year };
  }

  for (let i = 0; i < MONTHS.length; i++) {
    const regex = new RegExp(`\\b${MONTHS[i]}\\b\\s*(\\d{4})?`, 'i');
    const m = description.match(regex);
    if (m) {
      const year = m[1] ? Number(m[1]) : null;
      if (year) return { month: i + 1, year };
    }
  }

  const dueDate = bill?.dueDate ? new Date(bill.dueDate) : null;
  if (dueDate && !Number.isNaN(dueDate.getTime())) {
    return { month: dueDate.getMonth() + 1, year: dueDate.getFullYear() };
  }

  const createdAt = bill?.createdAt ? new Date(bill.createdAt) : null;
  if (createdAt && !Number.isNaN(createdAt.getTime())) {
    return { month: createdAt.getMonth() + 1, year: createdAt.getFullYear() };
  }

  return { month: null, year: null };
};

module.exports = {
  MONTHS,
  extractBillMonthYear,
};
