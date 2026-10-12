import test from 'node:test';
import assert from 'node:assert/strict';
import {istDate,distanceMeters,validateLocation,fileKind,safeSheetCell} from '../src/lib/security.mjs';
test('server dates follow IST across UTC midnight',()=>{assert.equal(istDate(new Date('2026-10-11T20:00:00Z')),'2026-10-12');});
test('geofence distances are measured, not accepted map links',()=>{assert.ok(distanceMeters(26.15,87.46,26.151,87.46)>110);assert.ok(distanceMeters(26.15,87.46,26.151,87.46)<112);assert.equal(distanceMeters(26.15,87.46,26.15,87.46),0);});
test('reject bad accuracy, missing and impossible coordinates',()=>{for(const x of [[26,87,51],[NaN,87,20],[91,87,10],[26,181,10],[26,87,0]])assert.throws(()=>validateLocation(...x));assert.doesNotThrow(()=>validateLocation(26,87,50));});
test('validate actual file magic, not extension',()=>{assert.equal(fileKind(new Uint8Array([255,216,255,0])),'image/jpeg');assert.equal(fileKind(new TextEncoder().encode('%PDF-1.7')),'application/pdf');assert.equal(fileKind(new TextEncoder().encode('<script>')),null);});
test('spreadsheet formula content cannot execute',()=>{assert.equal(safeSheetCell('=IMPORTXML("secret")'),'\'=IMPORTXML("secret")');assert.equal(safeSheetCell('कर्मी नाम'),'कर्मी नाम');});
