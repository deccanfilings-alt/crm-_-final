/**
 * Centralized Meta Cloud API Error Diagnostic Registry & Service Window Utilities
 *
 * WhatsApp Business Cloud API returns structured error codes. This module
 * normalizes them into human-readable explanations and provides actionable
 * remediation guidance for operators.
 */

export interface MetaParsedError {
  userMessage: string;
  code: string;
  numericCode?: number;
  isActionable: boolean;
  action?: string;
  isWindowExpired?: boolean;
}

export const META_ERROR_DESCRIPTIONS: Record<
  number,
  { message: string; action: string; isWindowExpired?: boolean }
> = {
  131047: {
    message: "24-hour customer service window is closed.",
    action: "Send an approved WhatsApp template to re-engage this customer.",
    isWindowExpired: true,
  },
  131026: {
    message: "Message undeliverable. The phone number is not registered on WhatsApp or has blocked this business.",
    action: "Verify the customer's phone number or contact them via alternate channels.",
  },
  132000: {
    message: "Template parameter count or variable format mismatch.",
    action: "Check the approved template schema on Meta Business Manager and provide all required variable parameters.",
  },
  132001: {
    message: "Template does not exist or has not been approved for this language.",
    action: "Ensure the template exists and is APPROVED in the selected language.",
  },
  132012: {
    message: "Template has been paused by Meta due to low quality rating.",
    action: "Review customer complaints or unpause the template in Meta Business Manager.",
  },
  132015: {
    message: "Template is disabled by Meta.",
    action: "Create a new template that complies with WhatsApp Messaging Policy.",
  },
  130429: {
    message: "WhatsApp Cloud API throughput rate limit exceeded.",
    action: "Wait a few seconds before retrying; consider upgrading your messaging limit tier.",
  },
  80007: {
    message: "Rate limit reached on Meta Graph API.",
    action: "Reduce the frequency of outbound API requests.",
  },
  190: {
    message: "Meta System User access token has expired or permissions were revoked.",
    action: "Re-generate the permanent System User access token in Meta Business Manager and update CRM settings.",
  },
  131051: {
    message: "Unsupported media format or media file size exceeds WhatsApp limits.",
    action: "Ensure audio is <16MB, images <5MB, and documents <100MB in supported formats.",
  },
  131052: {
    message: "Media download failed from Meta servers.",
    action: "Verify media URL accessibility and retry.",
  },
  131009: {
    message: "Parameter value is invalid.",
    action: "Inspect message payload parameters for formatting errors.",
  },
  133010: {
    message: "Phone number registration issue.",
    action: "Ensure the phone number is verified and registered under your WABA.",
  },
};

/**
 * Translates any raw error or Meta error response into an actionable diagnostic.
 */
export function parseMetaError(error: unknown): MetaParsedError {
  if (!error) {
    return {
      userMessage: "Unknown delivery failure.",
      code: "UNKNOWN",
      isActionable: false,
    };
  }

  // Handle object with code or error_data
  let numCode: number | undefined;
  let rawMessage = "";

  if (typeof error === "object") {
    const errObj = error as Record<string, unknown>;

    // Support nested error format { error: { code, message } }
    const target =
      errObj.error && typeof errObj.error === "object"
        ? (errObj.error as Record<string, unknown>)
        : errObj;

    const rawCode = target.code ?? target.error_subcode;
    if (typeof rawCode === "number") {
      numCode = rawCode;
    } else if (typeof rawCode === "string") {
      const parsed = parseInt(rawCode, 10);
      if (!isNaN(parsed)) numCode = parsed;
    }

    rawMessage =
      (typeof target.message === "string" ? target.message : "") ||
      (typeof target.details === "string" ? target.details : "") ||
      (typeof errObj.message === "string" ? errObj.message : "");
  } else if (typeof error === "string") {
    rawMessage = error;
    const match = error.match(/\b(13\d{4}|80007|190)\b/);
    if (match) {
      numCode = parseInt(match[1], 10);
    }
  }

  if (numCode && META_ERROR_DESCRIPTIONS[numCode]) {
    const def = META_ERROR_DESCRIPTIONS[numCode];
    return {
      userMessage: def.message,
      code: `META_${numCode}`,
      numericCode: numCode,
      isActionable: true,
      action: def.action,
      isWindowExpired: def.isWindowExpired,
    };
  }

  return {
    userMessage: rawMessage || "Message delivery failed. Please check WhatsApp Cloud API logs.",
    code: numCode ? `META_${numCode}` : "META_ERROR",
    numericCode: numCode,
    isActionable: false,
  };
}

/**
 * 24-Hour Customer Service Window calculation.
 *
 * WhatsApp enforces a 24-hour conversation window triggered by the customer's
 * last inbound message. During this window, any free-form message (text, media,
 * interactive buttons) can be sent. Once 24 hours expire, only pre-approved
 * Meta templates can be sent.
 */
export function check24HourServiceWindow(
  lastCustomerMessageAt: string | Date | null | undefined
): {
  isOpen: boolean;
  isExpired: boolean;
  remainingMs: number;
  remainingHours: number;
  remainingMinutes: number;
  formattedRemaining: string;
} {
  if (!lastCustomerMessageAt) {
    // If the customer has never messaged, the service window is closed
    return {
      isOpen: false,
      isExpired: true,
      remainingMs: 0,
      remainingHours: 0,
      remainingMinutes: 0,
      formattedRemaining: "Expired (Template Required)",
    };
  }

  const lastMsgTime =
    typeof lastCustomerMessageAt === "string"
      ? new Date(lastCustomerMessageAt).getTime()
      : lastCustomerMessageAt.getTime();

  if (isNaN(lastMsgTime)) {
    return {
      isOpen: false,
      isExpired: true,
      remainingMs: 0,
      remainingHours: 0,
      remainingMinutes: 0,
      formattedRemaining: "Expired (Template Required)",
    };
  }

  const WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours in milliseconds
  const now = Date.now();
  const elapsedMs = now - lastMsgTime;
  const remainingMs = WINDOW_MS - elapsedMs;

  if (remainingMs <= 0) {
    return {
      isOpen: false,
      isExpired: true,
      remainingMs: 0,
      remainingHours: 0,
      remainingMinutes: 0,
      formattedRemaining: "Expired (Template Required)",
    };
  }

  const remainingHours = Math.floor(remainingMs / (60 * 60 * 1000));
  const remainingMinutes = Math.floor(
    (remainingMs % (60 * 60 * 1000)) / (60 * 1000)
  );

  return {
    isOpen: true,
    isExpired: false,
    remainingMs,
    remainingHours,
    remainingMinutes,
    formattedRemaining: `${remainingHours}h ${remainingMinutes}m remaining`,
  };
}
