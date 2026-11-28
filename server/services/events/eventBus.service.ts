import crypto = require('crypto');
import amqp = require('amqplib');
import envConfigModule = require('../../config/env.config');
const { getEnvConfig } = envConfigModule;
import sentryService = require('../infrastructure/sentry.service');

// ============================================================================
// RABBITMQ DOMAIN EVENT BUS
// Publishes and subscribes to domain events over a durable RabbitMQ topic
// exchange (`budget_app.events`). Services emit domain facts without knowing
// which downstream consumers react to them.
// ============================================================================

const EVENTS_EXCHANGE = 'budget_app.events';

const DomainEvents = {
  USER_LOGGED_IN: 'user.logged_in',
  PLAID_SYNC_UPDATES_AVAILABLE: 'plaid.webhook.sync_updates_available',
  PLAID_ITEM_ERROR: 'plaid.webhook.item_error',
  BANK_ENROLLMENT_CREATED: 'bank.enrollment.created',
  BANK_SYNC_REQUESTED: 'bank.sync.requested',
  BANK_SYNC_COMPLETED: 'bank.sync.completed',
  PUSH_NOTIFICATION_REQUESTED: 'push.notification.requested',
} as const;

interface DomainEventEnvelope<T = Record<string, any>> {
  id: string;
  type: string;
  occurredAt: string;
  payload: T;
}

interface PublishEventOptions {
  id?: string;
  priority?: number;
  headers?: Record<string, any>;
}

interface SubscribeOptions {
  prefetch?: number;
  arguments?: Record<string, any>;
  manualAck?: boolean;
}

let connection: any = null;
let channel: any = null;
let connectingPromise: Promise<any> | null = null;
let customChannelFactory: (() => Promise<any>) | null = null;

// Allow tests to inject an AMQP-compatible channel factory
function setChannelFactory(factory: (() => Promise<any>) | null) {
  customChannelFactory = factory;
  connection = null;
  channel = null;
  connectingPromise = null;
}

async function getChannel(): Promise<any> {
  if (channel) {
    return channel;
  }

  if (connectingPromise) {
    return await connectingPromise;
  }

  connectingPromise = (async () => {
    try {
      if (customChannelFactory) {
        const ch = await customChannelFactory();
        await ch.assertExchange(EVENTS_EXCHANGE, 'topic', { durable: true });
        channel = ch;
        return ch;
      }

      const { rabbitmqUrl } = getEnvConfig();
      const conn = await amqp.connect(rabbitmqUrl);
      conn.on('error', (err) => {
        sentryService.captureException(err, {
          service: 'eventBus.service',
          action: 'connectionError',
        });
      });
      conn.on('close', () => {
        connection = null;
        channel = null;
      });

      const ch = await conn.createChannel();
      ch.on('error', (err) => {
        sentryService.captureException(err, {
          service: 'eventBus.service',
          action: 'channelError',
        });
      });
      ch.on('close', () => {
        channel = null;
      });

      await ch.assertExchange(EVENTS_EXCHANGE, 'topic', { durable: true });
      connection = conn;
      channel = ch;
      return ch;
    } finally {
      connectingPromise = null;
    }
  })();

  return await connectingPromise;
}

// Publish a domain event to the RabbitMQ topic exchange
async function publishEvent<T = Record<string, any>>(
  eventType: string,
  payload: T,
  options: PublishEventOptions = {}
): Promise<DomainEventEnvelope<T>> {
  const envelope: DomainEventEnvelope<T> = {
    id: options.id || `evt_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
    type: eventType,
    occurredAt: new Date().toISOString(),
    payload,
  };

  try {
    const ch = await getChannel();
    const publishOpts: Record<string, any> = {
      persistent: true,
      contentType: 'application/json',
      messageId: envelope.id,
      timestamp: Date.now(),
    };
    if (typeof options.priority === 'number') {
      publishOpts.priority = options.priority;
    }
    if (options.headers) {
      publishOpts.headers = options.headers;
    }

    ch.publish(EVENTS_EXCHANGE, eventType, Buffer.from(JSON.stringify(envelope)), publishOpts);
    return envelope;
  } catch (err) {
    sentryService.captureException(err, {
      service: 'eventBus.service',
      action: 'publishEvent',
      eventType,
    });
    throw err;
  }
}

// Subscribe a durable queue to one or more domain event routing keys
async function subscribeToEvents(
  queueName: string,
  routingKeys: string[],
  handler: (envelope: DomainEventEnvelope, msg: any, ch: any) => Promise<void>,
  options: SubscribeOptions = {}
) {
  const ch = await getChannel();

  if (typeof options.prefetch === 'number' && typeof ch.prefetch === 'function') {
    await ch.prefetch(options.prefetch);
  }

  await ch.assertQueue(queueName, {
    durable: true,
    ...(options.arguments ? { arguments: options.arguments } : {}),
  });

  for (const key of routingKeys) {
    await ch.bindQueue(queueName, EVENTS_EXCHANGE, key);
  }

  return await ch.consume(queueName, async (msg) => {
    if (!msg) {
      return;
    }

    let envelope: DomainEventEnvelope;
    try {
      envelope = JSON.parse(msg.content.toString('utf8'));
    } catch (parseErr) {
      sentryService.captureException(parseErr, {
        service: 'eventBus.service',
        action: 'parseMessage',
        queueName,
      });
      ch.nack(msg, false, false);
      return;
    }

    try {
      await handler(envelope, msg, ch);
      if (!options.manualAck) {
        ch.ack(msg);
      }
    } catch (err) {
      sentryService.captureException(err, {
        service: 'eventBus.service',
        action: 'consumeHandler',
        queueName,
        eventType: envelope?.type,
        eventId: envelope?.id,
      });
      if (!options.manualAck) {
        ch.nack(msg, false, false);
      }
    }
  });
}

async function close() {
  const ch = channel;
  const conn = connection;
  channel = null;
  connection = null;
  connectingPromise = null;

  if (ch && typeof ch.close === 'function') {
    try {
      await ch.close();
    } catch {
      // Ignore already-closed channel errors
    }
  }
  if (conn && typeof conn.close === 'function') {
    try {
      await conn.close();
    } catch {
      // Ignore already-closed connection errors
    }
  }
}

function getEventBusConfig() {
  const { rabbitmqUrl } = getEnvConfig();
  return {
    rabbitmqUrl,
    exchangeName: EVENTS_EXCHANGE,
  };
}

export = {
  EVENTS_EXCHANGE,
  DomainEvents,
  setChannelFactory,
  getChannel,
  publishEvent,
  subscribeToEvents,
  close,
  getEventBusConfig,
};
