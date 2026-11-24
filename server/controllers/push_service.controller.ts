import pushServiceModule = require('../push_service');
const { pushService, pushQueue } = pushServiceModule;

// GET /api/push/vapid-public-key — return public VAPID applicationServerKey for PushManager.subscribe()
export const getVapidPublicKey = (req, res) => {
  const vapid = pushService.getVapidConfig();
  res.json({
    configured: vapid.configured,
    vapidPublicKey: vapid.publicKey,
  });
};

// GET /api/push/subscriptions — list the authenticated user's registered push devices
export const listSubscriptions = async (req, res, next) => {
  try {
    const subscriptions = await pushService.listUserSubscriptions(req.user.id);
    res.json({
      count: subscriptions.length,
      subscriptions,
    });
  } catch (err) {
    next(err);
  }
};

// POST /api/push/subscribe — save or update a browser PushSubscription.toJSON() in PostgreSQL
export const subscribe = async (req, res, next) => {
  try {
    const subscriptionPayload = req.body?.subscription || req.body;
    const userAgent = req.get('user-agent') || null;
    const saved = await pushService.saveSubscription(req.user.id, subscriptionPayload, userAgent);
    const subscriptions = await pushService.listUserSubscriptions(req.user.id);

    res.status(201).json({
      ok: true,
      subscription: saved,
      count: subscriptions.length,
    });
  } catch (err) {
    if (err.status === 400) {
      return res.status(400).json({ error: err.message });
    }
    next(err);
  }
};

// DELETE /api/push/subscribe — remove a device PushSubscription by endpoint from PostgreSQL
export const unsubscribe = async (req, res, next) => {
  try {
    const endpoint = req.body?.endpoint || req.query?.endpoint;
    if (!endpoint || typeof endpoint !== 'string') {
      return res.status(400).json({ error: 'Subscription endpoint is required' });
    }

    const removed = await pushService.removeSubscription(req.user.id, endpoint);
    const subscriptions = await pushService.listUserSubscriptions(req.user.id);

    res.json({
      ok: true,
      removed: removed > 0,
      count: subscriptions.length,
    });
  } catch (err) {
    next(err);
  }
};

// POST /api/push/test — enqueue a test notification into RabbitMQ and process delivery
export const sendTestNotification = async (req, res, next) => {
  try {
    const job = await pushQueue.enqueuePushNotificationJob(
      req.user.id,
      {
        title: 'Budget App Notifications Enabled',
        body: 'You will receive alerts here when your bank balances and transactions sync.',
        url: '/dashboard',
        tag: 'budget-app-test-notification',
      },
      {
        source: 'manual_test',
      }
    );

    const result = await pushQueue.processNextPushJob();

    res.json({
      ok: true,
      jobId: job.id,
      delivery: result
        ? {
            status: result.status,
            deliveredCount: result.deliveredCount || 0,
            prunedCount: result.prunedCount || 0,
          }
        : null,
    });
  } catch (err) {
    next(err);
  }
};
