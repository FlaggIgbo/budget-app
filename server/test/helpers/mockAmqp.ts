// In-test AMQP channel & topic broker double for RabbitMQ event bus tests.
// Simulates exchanges, topic routing keys, priority queues, bindings, consume(),
// ack/nack, and sendToQueue() without requiring a live RabbitMQ server in unit tests.

export interface MockAmqpMessage {
  content: Buffer;
  fields: {
    exchange: string;
    routingKey: string;
    deliveryTag: number;
  };
  properties: Record<string, any>;
}

function topicMatches(pattern: string, routingKey: string): boolean {
  if (pattern === '#' || pattern === routingKey) {
    return true;
  }
  const regexStr =
    '^' +
    pattern
      .split('.')
      .map((part) => {
        if (part === '#') return '.*';
        if (part === '*') return '[^.]+';
        return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      })
      .join('\\.') +
    '$';
  return new RegExp(regexStr).test(routingKey);
}

export function createMockAmqpBroker() {
  const exchanges = new Map<string, { type: string; options: Record<string, any> }>();
  const queues = new Map<string, { messages: MockAmqpMessage[]; options: Record<string, any> }>();
  const bindings: Array<{ queue: string; exchange: string; pattern: string }> = [];
  const consumers = new Map<string, (msg: MockAmqpMessage | null) => Promise<void> | void>();
  const publishedEvents: Array<{
    exchange: string;
    routingKey: string;
    envelope: any;
    properties: Record<string, any>;
  }> = [];
  let deliveryTagSeq = 1;

  function ensureQueue(name: string, options: Record<string, any> = {}) {
    if (!queues.has(name)) {
      queues.set(name, { messages: [], options });
    }
    return queues.get(name)!;
  }

  function enqueueToQueue(queueName: string, msg: MockAmqpMessage) {
    const q = ensureQueue(queueName);
    q.messages.push(msg);
    // Honor RabbitMQ x-max-priority ordering when configured on the queue
    if (q.options?.arguments?.['x-max-priority']) {
      q.messages.sort((a, b) => (b.properties?.priority || 0) - (a.properties?.priority || 0));
    }
  }

  const channel = {
    async assertExchange(name: string, type: string, options: Record<string, any> = {}) {
      exchanges.set(name, { type, options });
      return { exchange: name };
    },

    async assertQueue(name: string, options: Record<string, any> = {}) {
      const q = ensureQueue(name, options);
      q.options = { ...q.options, ...options };
      return {
        queue: name,
        messageCount: q.messages.length,
        consumerCount: consumers.has(name) ? 1 : 0,
      };
    },

    async bindQueue(queue: string, exchange: string, pattern: string) {
      const exists = bindings.some(
        (b) => b.queue === queue && b.exchange === exchange && b.pattern === pattern
      );
      if (!exists) {
        bindings.push({ queue, exchange, pattern });
      }
    },

    async prefetch(_count: number) {
      // No-op in mock
    },

    publish(
      exchange: string,
      routingKey: string,
      content: Buffer,
      properties: Record<string, any> = {}
    ) {
      let envelope: any;
      try {
        envelope = JSON.parse(content.toString('utf8'));
      } catch {
        envelope = content.toString('utf8');
      }
      publishedEvents.push({ exchange, routingKey, envelope, properties });

      for (const b of bindings) {
        if (b.exchange === exchange && topicMatches(b.pattern, routingKey)) {
          enqueueToQueue(b.queue, {
            content,
            fields: {
              exchange,
              routingKey,
              deliveryTag: deliveryTagSeq++,
            },
            properties,
          });
        }
      }
      return true;
    },

    sendToQueue(queue: string, content: Buffer, properties: Record<string, any> = {}) {
      enqueueToQueue(queue, {
        content,
        fields: {
          exchange: '',
          routingKey: queue,
          deliveryTag: deliveryTagSeq++,
        },
        properties,
      });
      return true;
    },

    async consume(queue: string, handler: (msg: MockAmqpMessage | null) => Promise<void> | void) {
      ensureQueue(queue);
      consumers.set(queue, handler);
      return { consumerTag: `mock_consumer_${queue}` };
    },

    ack(_msg: MockAmqpMessage) {
      // Acknowledged
    },

    nack(_msg: MockAmqpMessage, _allUpTo?: boolean, _requeue?: boolean) {
      // Negatively acknowledged
    },

    async close() {
      // No-op
    },
  };

  return {
    channel,
    channelFactory: async () => channel,

    // Deliver the next queued message to its registered consumer
    async drainNext(queueName: string): Promise<boolean> {
      const q = queues.get(queueName);
      const handler = consumers.get(queueName);
      if (!q || !handler || q.messages.length === 0) {
        return false;
      }
      const msg = q.messages.shift()!;
      await handler(msg);
      return true;
    },

    // Deliver all currently queued messages in a queue (including any re-enqueued messages up to maxSteps)
    async drainAll(queueName: string, maxSteps = 50): Promise<number> {
      let processed = 0;
      while (processed < maxSteps && (await this.drainNext(queueName))) {
        processed += 1;
      }
      return processed;
    },

    getPublishedEvents(routingKey?: string) {
      if (!routingKey) {
        return [...publishedEvents];
      }
      return publishedEvents.filter((e) => e.routingKey === routingKey);
    },

    getQueueMessages(queueName: string) {
      const q = queues.get(queueName);
      if (!q) return [];
      return q.messages.map((m) => ({
        ...m,
        json: JSON.parse(m.content.toString('utf8')),
      }));
    },

    reset() {
      publishedEvents.length = 0;
      for (const q of queues.values()) {
        q.messages.length = 0;
      }
    },
  };
}
