// utils.js
import fs from 'fs';
import path from 'path';

const DASHBOARD_PATH = path.resolve(process.cwd(), 'public/dashboard.html');
const LOGIN_PATH     = path.resolve(process.cwd(), 'public/login.html');

export const DASHBOARD_HTML = fs.readFileSync(DASHBOARD_PATH, 'utf8');
export const LOGIN_HTML     = fs.readFileSync(LOGIN_PATH, 'utf8');

export const JWT_SECRET = process.env.JWT_SECRET || 'main-secret-key-change-in-production';
export const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
export const SUB_ADMIN_KEY = process.env.SUB_ADMIN_KEY || 'admin-secret-key';