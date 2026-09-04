import 'dotenv/config';

export function getMonday(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function addDays(date, amount) {
  const next = new Date(date);
  next.setDate(next.getDate() + amount);
  return next;
}

export function formatDate(date) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
  }).format(date);
}

export function getWeekRangeLabel(startDate) {
  const endDate = addDays(startDate, 6);
  return `${formatDate(startDate)} - ${formatDate(endDate)}`;
}

export function getWeekKey(date) {
  return getMonday(date).toISOString().slice(0, 10);
}