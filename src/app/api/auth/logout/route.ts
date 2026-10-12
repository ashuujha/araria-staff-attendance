import {csrf,sessionCookie,json,failure} from '../../../../lib/server';
export async function POST(req:Request){try{csrf(req);return json({success:true},200,{'Set-Cookie':sessionCookie('araria_session','',0)});}catch(e){return failure(e);}}
