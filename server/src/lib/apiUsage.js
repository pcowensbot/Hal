// Shared helpers for device-authenticated routes (/v1/* and /api/llm/*).
// Consolidates two previously duplicated copies of checkAndUpdateRateLimit
// and logApiRequest. Both routes need identical semantics for per-user API
// call accounting and for persisting audit log rows.

import prisma from '../config/database.js';
import logger from './logger.js';

const LOG_CONTENT_MAX_LENGTH = 2000;

/**
 * Check the per-user daily/monthly API call limits, increment the counters
 * if the request is allowed. The counters are stored directly on the User
 * row (apiCallsToday / apiCallsMonth) with reset timestamps so midnight /
 * first-of-month transitions are handled lazily.
 *
 * Returns:
 *   { allowed: true,  daily: {current, limit}, monthly: {current, limit} }
 *   { allowed: false, error, limitType: 'daily'|'monthly', current, limit }
 *   { allowed: false, error: 'User not found' }
 */
export async function checkAndUpdateApiLimit(userId) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const thisMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      apiLimitDaily: true,
      apiLimitMonthly: true,
      apiCallsToday: true,
      apiCallsMonth: true,
      apiLimitResetDay: true,
      apiLimitResetMonth: true,
    },
  });

  if (!user) {
    return { allowed: false, error: 'User not found' };
  }

  let apiCallsToday = user.apiCallsToday;
  let resetDay = false;
  if (!user.apiLimitResetDay || new Date(user.apiLimitResetDay) < today) {
    apiCallsToday = 0;
    resetDay = true;
  }

  let apiCallsMonth = user.apiCallsMonth;
  let resetMonth = false;
  if (!user.apiLimitResetMonth || new Date(user.apiLimitResetMonth) < thisMonth) {
    apiCallsMonth = 0;
    resetMonth = true;
  }

  if (user.apiLimitDaily !== null && apiCallsToday >= user.apiLimitDaily) {
    return {
      allowed: false,
      error: `Daily API limit reached (${user.apiLimitDaily} calls). Resets at midnight.`,
      limitType: 'daily',
      current: apiCallsToday,
      limit: user.apiLimitDaily,
    };
  }

  if (user.apiLimitMonthly !== null && apiCallsMonth >= user.apiLimitMonthly) {
    return {
      allowed: false,
      error: `Monthly API limit reached (${user.apiLimitMonthly} calls). Resets on the 1st.`,
      limitType: 'monthly',
      current: apiCallsMonth,
      limit: user.apiLimitMonthly,
    };
  }

  const updateData = {
    apiCallsToday: apiCallsToday + 1,
    apiCallsMonth: apiCallsMonth + 1,
  };
  if (resetDay) updateData.apiLimitResetDay = today;
  if (resetMonth) updateData.apiLimitResetMonth = thisMonth;

  await prisma.user.update({ where: { id: userId }, data: updateData });

  return {
    allowed: true,
    daily: { current: apiCallsToday + 1, limit: user.apiLimitDaily },
    monthly: { current: apiCallsMonth + 1, limit: user.apiLimitMonthly },
  };
}

/**
 * Persist a DeviceApiLog row. Prompt/response bodies are only stored if the
 * device opted in (device.logPromptContent); otherwise nulled out — keeps
 * /v1 private-by-default for the in-house ChatGPT pitch. Long content gets
 * truncated at LOG_CONTENT_MAX_LENGTH.
 *
 * Failures are logged but not thrown — callers should not block a successful
 * request on logging errors.
 */
export async function logApiRequest(device, entry) {
  const { endpoint, method, model, prompt, response, status, durationMs, tokenCount, error, metadata } = entry;

  const storePrompt = device.logPromptContent ? prompt : null;
  const storeResponse = device.logPromptContent ? response : null;
  const truncatedPrompt = storePrompt && storePrompt.length > LOG_CONTENT_MAX_LENGTH
    ? storePrompt.substring(0, LOG_CONTENT_MAX_LENGTH) + '...'
    : storePrompt;
  const truncatedResponse = storeResponse && storeResponse.length > LOG_CONTENT_MAX_LENGTH
    ? storeResponse.substring(0, LOG_CONTENT_MAX_LENGTH) + '...'
    : storeResponse;

  try {
    await prisma.deviceApiLog.create({
      data: {
        deviceId: device.id,
        endpoint,
        method,
        model,
        prompt: truncatedPrompt,
        response: truncatedResponse,
        status,
        durationMs,
        tokenCount,
        error,
        metadata,
      },
    });
  } catch (err) {
    logger.error({ err, endpoint, deviceId: device.id }, 'Failed to persist DeviceApiLog');
  }
}
