# Budget App Client

Angular 19 frontend for the Budget App. Connects to the Node/Express API via proxy in development.

## Development

```bash
npm install
ng serve
```

Open `http://localhost:4200`. The app proxies `/api` to the backend.

## Build

```bash
ng build
```

## Tests

```bash
ng test
```

For CI (headless, single run):

```bash
ng test --no-watch --browsers=ChromeHeadless
```

Component tests cover Login, Dashboard, Bank Accounts, and Profile pages.
