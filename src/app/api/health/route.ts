import {json,configured} from '../../../lib/server';
export async function GET(){return json({status:configured()?'configured':'setup_pending',server_time:new Date().toISOString(),timezone:'Asia/Kolkata',sheets_configured:!!process.env.GOOGLE_SHEET_ID});}
