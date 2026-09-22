import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  sendInteractiveButtons,
  sendInteractiveList,
  sendInteractiveLocationRequest,
} from './meta-api';

describe('Meta API - Interactive Messages', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe('sendInteractiveButtons', () => {
    it('throws error when no buttons are provided', async () => {
      await expect(
        sendInteractiveButtons({
          phoneNumberId: '123456',
          accessToken: 'token',
          to: '919876543210',
          bodyText: 'Choose an option:',
          buttons: [],
        })
      ).rejects.toThrow('Interactive button message requires 1-3 buttons');
    });

    it('throws error when more than 3 buttons are provided', async () => {
      await expect(
        sendInteractiveButtons({
          phoneNumberId: '123456',
          accessToken: 'token',
          to: '919876543210',
          bodyText: 'Choose an option:',
          buttons: [
            { id: '1', title: 'One' },
            { id: '2', title: 'Two' },
            { id: '3', title: 'Three' },
            { id: '4', title: 'Four' },
          ],
        })
      ).rejects.toThrow('Interactive button message requires 1-3 buttons');
    });

    it('throws error when a button title exceeds 20 characters', async () => {
      await expect(
        sendInteractiveButtons({
          phoneNumberId: '123456',
          accessToken: 'token',
          to: '919876543210',
          bodyText: 'Choose an option:',
          buttons: [
            { id: '1', title: 'This button title is far too long for Meta' },
          ],
        })
      ).rejects.toThrow(/exceeds 20 chars/);
    });

    it('dispatches valid button payload to Meta API correctly', async () => {
      vi.mocked(global.fetch).mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            messages: [{ id: 'wamid.HBgLMTIzNDU2' }],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      );

      const result = await sendInteractiveButtons({
        phoneNumberId: '123456',
        accessToken: 'valid-token',
        to: '919876543210',
        bodyText: 'Would you like to file GST return?',
        headerText: 'Tax Services',
        footerText: 'Deccan Filings',
        buttons: [
          { id: 'btn_yes', title: 'Yes, File Now' },
          { id: 'btn_no', title: 'Not Now' },
        ],
      });

      expect(result.messageId).toBe('wamid.HBgLMTIzNDU2');
      expect(global.fetch).toHaveBeenCalledTimes(1);

      const callArgs = vi.mocked(global.fetch).mock.calls[0];
      const payload = JSON.parse(callArgs[1]?.body as string);

      expect(payload.type).toBe('interactive');
      expect(payload.interactive.type).toBe('button');
      expect(payload.interactive.action.buttons).toHaveLength(2);
      expect(payload.interactive.action.buttons[0].reply.id).toBe('btn_yes');
    });
  });

  describe('sendInteractiveList', () => {
    it('throws error when sections have 0 rows', async () => {
      await expect(
        sendInteractiveList({
          phoneNumberId: '123456',
          accessToken: 'token',
          to: '919876543210',
          bodyText: 'Select a plan:',
          buttonLabel: 'View Plans',
          sections: [{ title: 'Plans', rows: [] }],
        })
      ).rejects.toThrow('Interactive list requires 1-10 rows total');
    });

    it('throws error when total rows across sections exceed 10', async () => {
      const rows = Array.from({ length: 11 }, (_, i) => ({
        id: `row_${i}`,
        title: `Row ${i}`,
      }));

      await expect(
        sendInteractiveList({
          phoneNumberId: '123456',
          accessToken: 'token',
          to: '919876543210',
          bodyText: 'Select a plan:',
          buttonLabel: 'View Plans',
          sections: [{ title: 'Section', rows }],
        })
      ).rejects.toThrow('Interactive list requires 1-10 rows total');
    });

    it('throws error on duplicate row IDs', async () => {
      await expect(
        sendInteractiveList({
          phoneNumberId: '123456',
          accessToken: 'token',
          to: '919876543210',
          bodyText: 'Select a plan:',
          buttonLabel: 'View Plans',
          sections: [
            {
              title: 'Section',
              rows: [
                { id: 'dup_id', title: 'Option 1' },
                { id: 'dup_id', title: 'Option 2' },
              ],
            },
          ],
        })
      ).rejects.toThrow(/duplicate row id/);
    });

    it('dispatches valid list payload to Meta API correctly', async () => {
      vi.mocked(global.fetch).mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            messages: [{ id: 'wamid.HBgLMTIzNDU2TElTVA==' }],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      );

      const result = await sendInteractiveList({
        phoneNumberId: '123456',
        accessToken: 'valid-token',
        to: '919876543210',
        bodyText: 'Please select your registration service:',
        buttonLabel: 'Select Service',
        sections: [
          {
            title: 'Company Services',
            rows: [
              { id: 'pvt_ltd', title: 'Private Limited', description: 'Incorporation & MCA filing' },
              { id: 'llp', title: 'LLP Registration', description: 'Partnership registration' },
            ],
          },
          {
            title: 'Tax Services',
            rows: [
              { id: 'gst', title: 'GST Registration', description: 'New GSTIN generation' },
            ],
          },
        ],
      });

      expect(result.messageId).toBe('wamid.HBgLMTIzNDU2TElTVA==');
      const callArgs = vi.mocked(global.fetch).mock.calls[0];
      const payload = JSON.parse(callArgs[1]?.body as string);

      expect(payload.type).toBe('interactive');
      expect(payload.interactive.type).toBe('list');
      expect(payload.interactive.action.sections).toHaveLength(2);
      expect(payload.interactive.action.button).toBe('Select Service');
    });
  });

  describe('sendInteractiveLocationRequest', () => {
    it('throws error when bodyText is empty', async () => {
      await expect(
        sendInteractiveLocationRequest({
          phoneNumberId: '123456',
          accessToken: 'token',
          to: '919876543210',
          bodyText: '',
        })
      ).rejects.toThrow('Interactive message requires bodyText.');
    });

    it('successfully sends location_request_message interactive payload', async () => {
      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          messages: [{ id: 'wamid.HBgLMTIzNDU2TE9D' }],
        }),
      } as Response);

      const result = await sendInteractiveLocationRequest({
        phoneNumberId: '123456',
        accessToken: 'valid-token',
        to: '919876543210',
        bodyText: 'Please share your delivery location with us.',
      });

      expect(result.messageId).toBe('wamid.HBgLMTIzNDU2TE9D');
      const callArgs = vi.mocked(global.fetch).mock.calls[0];
      const payload = JSON.parse(callArgs[1]?.body as string);

      expect(payload.messaging_product).toBe('whatsapp');
      expect(payload.type).toBe('interactive');
      expect(payload.interactive.type).toBe('location_request_message');
      expect(payload.interactive.body.text).toBe('Please share your delivery location with us.');
      expect(payload.interactive.action.name).toBe('send_location');
    });
  });
});
