module.exports = {
  '*.{js,ts,html,json,scss,css}': 'prettier --write',
  'server/**/*.js': (filenames) => {
    const relative = filenames.map((f) => f.replace(/^server\//, '')).join(' ');
    return relative ? `cd server && npx eslint --fix ${relative}` : [];
  },
  'client/src/**/*.{ts,html}': () => 'cd client && npx ng lint --fix',
};
