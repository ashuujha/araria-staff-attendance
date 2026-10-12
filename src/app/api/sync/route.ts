import {timingSafeEqual} from 'node:crypto';
import {json,failure,HttpError} from '../../../lib/server';
import {syncOne} from '../../../lib/sheets';
export const runtime='nodejs';
export const maxDuration=60;
export async function GET(req:Request){try{const expected='Bearer '+process.env.CRON_SECRET;const actual=req.headers.get('authorization')||'';if(!process.env.CRON_SECRET||Buffer.byteLength(actual)!==Buffer.byteLength(expected)||!timingSafeEqual(Buffer.from(actual),Buffer.from(expected)))throw new HttpError(401,'Unauthorized');if(!process.env.GOOGLE_SHEET_ID)throw new HttpError(503,'Google Sheets setup pending');return json(await syncOne());}catch(e){return failure(e);}}
