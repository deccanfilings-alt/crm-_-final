/**
 * Converts Indian Rupee amounts into formal words (Indian Numbering System: Lakhs, Crores).
 */
export function numberToWordsINR(amount: number): string {
  const num = Math.floor(Math.abs(amount));
  if (num === 0) return 'Zero Rupees Only';

  const units = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
    'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

  function convertHundreds(n: number): string {
    let str = '';
    if (n >= 100) {
      str += units[Math.floor(n / 100)] + ' Hundred ';
      n %= 100;
    }
    if (n >= 20) {
      str += tens[Math.floor(n / 10)] + ' ';
      n %= 10;
    }
    if (n > 0) {
      str += units[n] + ' ';
    }
    return str.trim();
  }

  const crore = Math.floor(num / 10000000);
  let remainder = num % 10000000;
  const lakh = Math.floor(remainder / 100000);
  remainder %= 100000;
  const thousand = Math.floor(remainder / 1000);
  remainder %= 1000;
  const hundreds = remainder;

  let words = '';
  if (crore > 0) {
    words += convertHundreds(crore) + ' Crore ';
  }
  if (lakh > 0) {
    words += convertHundreds(lakh) + ' Lakh ';
  }
  if (thousand > 0) {
    words += convertHundreds(thousand) + ' Thousand ';
  }
  if (hundreds > 0) {
    words += convertHundreds(hundreds) + ' ';
  }

  return `${words.trim()} Rupees Only`;
}
