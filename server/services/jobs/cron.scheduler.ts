import { setInterval, clearInterval } from 'node:timers';
import db = require('../../models');
import queueService = require('./queue.service');
import sentryService = require('../infrastructure/sentry.service');

// ============================================================================
// DAILY CRON SCHEDULER
// Runs once a day (every 24 hours) to enqueue normal-priority RabbitMQ sync
// jobs for all users with connected Plaid bank enrollments.
// ============================================================================

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
let cronTimer = null;

// Find all users with connected bank enrollments and enqueue daily sync jobs
async function runDailySyncCron() {
  try {
    const enrollments = await db.Enrollment.findAll({
      attributes: ['userId'],
    });

    const uniqueUserIds = new Set();
    for (let i = 0; i < enrollments.length; i++) {
      if (enrollments[i].userId) {
        uniqueUserIds.add(enrollments[i].userId);
      }
    }

    const enqueuedJobs = [];
    for (const userId of uniqueUserIds) {
      const job = await queueService.enqueueUserSyncJob(userId, {
        source: 'daily_cron',
        priority: queueService.PRIORITY_NORMAL,
      });
      enqueuedJobs.push(job);
    }

    return {
      ranAt: new Date().toISOString(),
      usersQueued: enqueuedJobs.length,
      jobs: enqueuedJobs,
    };
  } catch (err) {
    sentryService.captureException(err, {
      service: 'cron.scheduler',
      action: 'runDailySyncCron',
    });
    throw err;
  }
}

// Start the daily background scheduler
function startDailySyncScheduler(intervalMs?: number) {
  if (cronTimer) {
    return cronTimer;
  }

  const resolvedInterval =
    intervalMs || parseInt(process.env.DAILY_SYNC_CRON_INTERVAL_MS || String(ONE_DAY_MS), 10);

  cronTimer = setInterval(() => {
    runDailySyncCron().catch((err) => {
      sentryService.captureException(err, {
        service: 'cron.scheduler',
        action: 'scheduledTick',
      });
    });
  }, resolvedInterval);

  if (typeof cronTimer.unref === 'function') {
    cronTimer.unref();
  }

  return cronTimer;
}

// Stop the daily background scheduler
function stopDailySyncScheduler() {
  if (cronTimer) {
    clearInterval(cronTimer);
    cronTimer = null;
  }
}

export = {
  ONE_DAY_MS,
  runDailySyncCron,
  startDailySyncScheduler,
  stopDailySyncScheduler,
};
