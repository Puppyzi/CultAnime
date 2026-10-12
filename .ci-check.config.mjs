import config from './playwright.config.mjs';
export default {...config, webServer: undefined, retries: 0, use: {...config.use, baseURL: 'http://localhost:3000'}};
