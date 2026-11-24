import http = require('http');

// Native Node.js HTTP test helper using built-in `node:http` + Web Standards `fetch()`
// (replaces third-party `supertest`).
function normalizeCookieHeader(value) {
  if (Array.isArray(value)) {
    return value.map((c) => String(c).split(';')[0].trim()).join('; ');
  }
  return String(value);
}

interface TestResponse {
  status: number;
  body: any;
  text: string;
  headers: Record<string, any>;
}

class NativeTestRequest implements PromiseLike<TestResponse> {
  app: http.RequestListener;
  method: string;
  path: string;
  headers: Record<string, string>;
  payload: any;

  constructor(app: http.RequestListener, method: string, path: string) {
    this.app = app;
    this.method = method;
    this.path = path;
    this.headers = {};
    this.payload = undefined;
  }

  set(name, value) {
    if (value === undefined || value === null) {
      return this;
    }
    const lower = String(name).toLowerCase();
    this.headers[lower] = lower === 'cookie' ? normalizeCookieHeader(value) : String(value);
    return this;
  }

  send(body) {
    this.payload = body;
    return this;
  }

  async execute(): Promise<TestResponse> {
    const server = http.createServer(this.app);
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => resolve());
    });

    try {
      const { port } = server.address() as import('net').AddressInfo;
      const url = `http://127.0.0.1:${port}${this.path}`;
      const fetchHeaders = { ...this.headers };
      const init: RequestInit = {
        method: this.method,
        headers: fetchHeaders,
        redirect: 'manual',
      };

      if (this.payload !== undefined && this.method !== 'GET' && this.method !== 'HEAD') {
        if (typeof this.payload === 'string' || Buffer.isBuffer(this.payload)) {
          init.body = this.payload;
        } else {
          if (!fetchHeaders['content-type']) {
            fetchHeaders['content-type'] = 'application/json';
          }
          init.body = JSON.stringify(this.payload);
        }
      }

      const res = await fetch(url, init);
      const text = await res.text();
      let body = null;
      const contentType = res.headers.get('content-type') || '';
      if (text && contentType.includes('application/json')) {
        try {
          body = JSON.parse(text);
        } catch {
          body = text;
        }
      } else if (text) {
        body = text;
      }

      const headers: Record<string, any> = {};
      for (const [k, v] of res.headers.entries()) {
        headers[k.toLowerCase()] = v;
      }
      const setCookies =
        typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
      if (setCookies.length > 0) {
        headers['set-cookie'] = setCookies;
      } else {
        delete headers['set-cookie'];
      }

      return {
        status: res.status,
        body,
        text,
        headers,
      };
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  }

  then<TResult1 = TestResponse, TResult2 = never>(
    onFulfilled?: ((value: TestResponse) => TResult1 | PromiseLike<TResult1>) | null,
    onRejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null
  ): Promise<TResult1 | TResult2> {
    return this.execute().then(onFulfilled, onRejected);
  }

  catch(onRejected?: (reason: any) => any) {
    return this.execute().catch(onRejected);
  }
}

function request(app: http.RequestListener) {
  return {
    get: (path) => new NativeTestRequest(app, 'GET', path),
    post: (path) => new NativeTestRequest(app, 'POST', path),
    put: (path) => new NativeTestRequest(app, 'PUT', path),
    patch: (path) => new NativeTestRequest(app, 'PATCH', path),
    delete: (path) => new NativeTestRequest(app, 'DELETE', path),
    options: (path) => new NativeTestRequest(app, 'OPTIONS', path),
  };
}

export = request;
