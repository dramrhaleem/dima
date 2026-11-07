import {describe,it,expect} from 'vitest';
import {googleAvatar,validateAvatarJpeg} from '../../apps/web/src/server/avatar-validation';
import {saveAvatarSchema} from '../../packages/contracts/src/account';
const tiny=(w=256,h=256)=>`data:image/jpeg;base64,${btoa(String.fromCharCode(255,216,255,192,0,8,8,h>>8,h&255,w>>8,w&255,1,255,217))}`;
describe('profile avatar input boundary',()=>{
 it('accepts only a bounded JPEG frame and rejects active or oversized image payloads',()=>{
  expect(validateAvatarJpeg(tiny())).toBe(true);
  for(const value of ['https://example.test/a.jpg','data:image/svg+xml;base64,PHN2Zz4=',tiny(513),tiny(0),tiny().slice(0,-4),`data:image/jpeg;base64,${'a'.repeat(50000)}`,tiny().replace('jpeg','png')])expect(validateAvatarJpeg(value)).toBe(false);
 });
 it('allows only Google image hosts without credentials or ports',()=>{
  expect(googleAvatar({avatar_url:'https://lh3.googleusercontent.com/a/photo'})).toBe('https://lh3.googleusercontent.com/a/photo');
  for(const avatar_url of ['http://lh3.googleusercontent.com/a','https://googleusercontent.com.evil.test/a','https://user:secret@lh3.googleusercontent.com/a','https://lh3.googleusercontent.com:444/a','data:image/jpeg;base64,a'])expect(googleAvatar({avatar_url})).toBe(null);
 });
 it('rejects caller ownership and invalid concurrency fields',()=>{
  const valid={mode:'none',data:null,expectedRevision:0,operationId:'6a7a4aa0-0062-4a41-9a11-70f065ef6d90'};
  expect(saveAvatarSchema.safeParse(valid).success).toBe(true);
  for(const extra of [{owner:'someone'}, {expectedRevision:-1},{mode:'remote'},{operationId:'bad'}])expect(saveAvatarSchema.safeParse({...valid,...extra}).success).toBe(false);
 });
});
