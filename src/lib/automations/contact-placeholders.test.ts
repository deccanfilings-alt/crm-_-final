import { describe, it, expect } from 'vitest';
import { resolveContactPlaceholders, loadPlaceholderContact } from './contact-placeholders';

describe('resolveContactPlaceholders', () => {
  const contact = {
    name: 'vishnu reddy30',
    phone: '919876543210',
    email: 'vishnu@example.com',
    company: 'Acme Corp',
    custom: {
      'service type': 'Tax Filing',
      'gst number': '36AABCU9603R1ZM',
    },
  };

  it('resolves contact.name and contact.first_name with cleaning', () => {
    expect(resolveContactPlaceholders('Hello {{contact.name}}', contact)).toBe('Hello Vishnu Reddy');
    expect(resolveContactPlaceholders('Hi {{contact.first_name}}', contact)).toBe('Hi Vishnu');
  });

  it('resolves basic fields phone, email, and company', () => {
    expect(resolveContactPlaceholders('Call {{contact.phone}}', contact)).toBe('Call 919876543210');
    expect(resolveContactPlaceholders('Mail {{contact.email}}', contact)).toBe('Mail vishnu@example.com');
    expect(resolveContactPlaceholders('Org {{contact.company}}', contact)).toBe('Org Acme Corp');
  });

  it('resolves custom fields case-insensitively with spaces', () => {
    expect(resolveContactPlaceholders('Service: {{contact.custom.Service Type}}', contact)).toBe('Service: Tax Filing');
    expect(resolveContactPlaceholders('GST: {{contact.custom.gst number}}', contact)).toBe('GST: 36AABCU9603R1ZM');
  });

  it('supports pipe fallbacks when values are missing', () => {
    const emptyContact = { name: null, phone: null, email: null, company: null, custom: {} };

    expect(resolveContactPlaceholders('Hello {{contact.first_name|there}}', emptyContact)).toBe('Hello there');
    expect(resolveContactPlaceholders('Welcome {{contact.name|valued customer}}', emptyContact)).toBe('Welcome valued customer');
    expect(resolveContactPlaceholders('Your {{contact.company|business}}', emptyContact)).toBe('Your business');
    expect(resolveContactPlaceholders('Service: {{contact.custom.Plan|Standard}}', emptyContact)).toBe('Service: Standard');
  });

  it('replaces missing values with empty string when no fallback is provided', () => {
    const emptyContact = { name: null, phone: null, email: null, company: null, custom: {} };
    expect(resolveContactPlaceholders('Phone: {{contact.phone}}', emptyContact)).toBe('Phone: ');
    expect(resolveContactPlaceholders('Custom: {{contact.custom.Missing}}', emptyContact)).toBe('Custom: ');
  });

  it('handles null contact gracefully', () => {
    expect(resolveContactPlaceholders('Hi {{contact.first_name|friend}}', null)).toBe('Hi friend');
    expect(resolveContactPlaceholders('Hi {{contact.phone}}', null)).toBe('Hi ');
  });
});

describe('loadPlaceholderContact', () => {
  it('loads contact and flattens custom fields', async () => {
    const mockDb: any = {
      from: (table: string) => {
        expect(table).toBe('contacts');
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: {
                    name: 'Alice',
                    phone: '919876543210',
                    email: 'alice@example.com',
                    company: 'Initech',
                    contact_custom_values: [
                      { value: 'Gold', custom_fields: { field_name: 'Tier' } },
                    ],
                  },
                  error: null,
                }),
              }),
            }),
          }),
        };
      },
    };

    const res = await loadPlaceholderContact(mockDb, 'acc-1', 'contact-1');
    expect(res).toBeDefined();
    expect(res?.name).toBe('Alice');
    expect(res?.custom?.tier).toBe('Gold');
  });
});
