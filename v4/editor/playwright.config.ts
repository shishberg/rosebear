import {existsSync} from 'node:fs';
import {defineConfig} from '@playwright/test';
const chrome=process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || (existsSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')?'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome':undefined);
export default defineConfig({testDir:'./tests/browser',testIgnore:'hand.spec.ts',timeout:60000,workers:1,use:{baseURL:'http://127.0.0.1:5178',viewport:{width:1400,height:1000},launchOptions:{executablePath:chrome,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']}},webServer:{command:'npm run build && npx vite preview --host 127.0.0.1 --port 5178 --strictPort',url:'http://127.0.0.1:5178',reuseExistingServer:false,timeout:30000}});
