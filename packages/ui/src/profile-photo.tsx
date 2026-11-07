'use client';
import { useEffect, useRef, useState } from 'react';
import type { AccountProfile } from '@dima/contracts';
import { Avatar } from './avatar';

type Photo={avatarUrl:string|null;avatarMode:'google'|'custom'|'none';avatarRevision:number;googleAvatarUrl:string|null};
async function thumbnail(file:File):Promise<string>{
 if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>5*1024*1024)throw new Error('Choose a JPG, PNG or WebP image under 5 MB.');
 const url=URL.createObjectURL(file);
 try{
  const image=new Image();image.src=url;await image.decode();
  if(!image.naturalWidth||!image.naturalHeight||image.naturalWidth>8192||image.naturalHeight>8192)throw new Error('Choose an image no larger than 8192 pixels on either side.');
  const canvas=document.createElement('canvas');canvas.width=256;canvas.height=256;
  const ctx=canvas.getContext('2d');if(!ctx)throw new Error('This browser could not prepare the photo. Please try another image.');
  ctx.fillStyle='#ffffff';ctx.fillRect(0,0,256,256);
  const side=Math.min(image.naturalWidth,image.naturalHeight);
  ctx.drawImage(image,(image.naturalWidth-side)/2,(image.naturalHeight-side)/2,side,side,0,0,256,256);
  for(const quality of [.85,.7,.5,.35]){const data=canvas.toDataURL('image/jpeg',quality);if(data.length<=43715)return data;}
  throw new Error('This image is too detailed. Try a smaller or simpler photo.');
 }catch(error){if(error instanceof Error&&error.message.includes('Choose')||error instanceof Error&&error.message.includes('This'))throw error;throw new Error('Couldn’t read that image. Try another JPG, PNG or WebP.',{cause:error});}
 finally{URL.revokeObjectURL(url);}
}
export function ProfilePhoto({profile,owner,onUpdate,onChanged}:{profile:AccountProfile;owner:string;onUpdate:(profile:AccountProfile,owner:string)=>boolean;onChanged:(owner?:string)=>void}){
 const [draft,setDraft]=useState<{mode:Photo['avatarMode'];data:string|null}|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
 const latest=useRef(profile);useEffect(()=>{latest.current=profile;},[profile]);
 const mounted=useRef(true);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 const fileInput=useRef<HTMLInputElement>(null);
 const pending=useRef<{signature:string;operationId:string}|null>(null);
 const revision=useRef(profile.avatarRevision??0);
 const [conflict,setConflict]=useState(false);
 const preview=draft?draft.mode==='custom'?draft.data:draft.mode==='google'?profile.googleAvatarUrl:null:profile.avatarUrl;
 async function choose(file?:File){if(!file)return;setBusy(true);setError('');setMessage('');try{const data=await thumbnail(file);if(mounted.current){setDraft({mode:'custom',data});revision.current=latest.current.avatarRevision??0;setConflict(false);}}catch(reason){if(mounted.current)setError(reason instanceof Error?reason.message:'Couldn’t open this image.');}finally{if(mounted.current){setBusy(false);if(fileInput.current)fileInput.current.value='';}}}
 async function save(){if(!draft||busy)return;setBusy(true);setError('');setMessage('');const body={...draft,expectedRevision:revision.current};const signature=JSON.stringify(body);if(pending.current?.signature!==signature)pending.current={signature,operationId:crypto.randomUUID()};try{
  const response=await fetch('/api/v1/me/avatar',{method:'PATCH',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json','X-Dima-Account-Id':owner},body:JSON.stringify({...body,operationId:pending.current.operationId}),signal:AbortSignal.timeout(15000)});const result=await response.json();if(!mounted.current)return;
  if(response.status===401||result.error?.code==='ACCOUNT_CHANGED'){onChanged(owner);return;}
  if(!response.ok){if(response.status===409){setConflict(true);throw new Error('Your photo changed elsewhere. Reload the saved photo before trying again.');}throw new Error(result.error?.code==='GOOGLE_PHOTO_UNAVAILABLE'?'No Google photo is available. Sign in with Google or upload your own.':'Couldn’t save your photo. Your choice is still here; try again.');}
  if(result.data.accountId!==owner){onChanged(owner);return;}
  if(onUpdate({...latest.current,avatarUrl:result.data.avatarUrl,avatarMode:result.data.avatarMode,avatarRevision:result.data.avatarRevision,googleAvatarUrl:result.data.googleAvatarUrl},owner)){pending.current=null;revision.current=result.data.avatarRevision;setDraft(null);setMessage('Profile photo saved.');}
 }catch(reason){if(mounted.current)setError(reason instanceof Error?reason.message:'Couldn’t save your photo. Try again.');}finally{if(mounted.current)setBusy(false);}}
 async function review(){setBusy(true);try{const r=await fetch('/api/v1/me',{cache:'no-store',credentials:'same-origin',headers:{'X-Dima-Account-Id':owner},signal:AbortSignal.timeout(15000)});const result=await r.json();if(!mounted.current)return;if(r.status===401||result.data?.accountId!==owner){onChanged(owner);return;}if(!r.ok||!result.data.profile)throw new Error('Couldn’t reload the photo. Try again.');const photo=result.data.profile;if(onUpdate({...latest.current,avatarUrl:photo.avatarUrl,avatarMode:photo.avatarMode,avatarRevision:photo.avatarRevision,googleAvatarUrl:photo.googleAvatarUrl},owner)){revision.current=photo.avatarRevision??0;setDraft(null);setConflict(false);setError('');setMessage('Latest photo loaded. Choose your change again.');}}catch(reason){if(mounted.current)setError(reason instanceof Error?reason.message:'Couldn’t reload.');}finally{if(mounted.current)setBusy(false);}}
 function pick(mode:'google'|'none'){setDraft({mode,data:null});setError('');setMessage('');setConflict(false);revision.current=profile.avatarRevision??0;}
 return <section className="profile-photo" aria-labelledby="profile-photo-title"><div className="profile-photo-preview"><Avatar name={profile.displayName} src={preview} size="large"/><div><h2 id="profile-photo-title">Your profile photo</h2><p>{!draft&&profile.avatarMode==='google'&&profile.googleAvatarUrl?'Using your Google account photo automatically.':'Choose how you appear to other learners.'}</p><small>Your photo accompanies your name where you choose to appear in Dima.</small></div></div><input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp" aria-label="Choose profile photo" className="profile-photo-input" disabled={busy} onChange={event=>void choose(event.target.files?.[0])}/><div className="profile-photo-actions"><button type="button" className="secondary" disabled={busy} onClick={()=>fileInput.current?.click()}>Upload photo</button>{profile.googleAvatarUrl&&<button type="button" className="quiet" disabled={busy} onClick={()=>pick('google')}>Use Google photo</button>}{(preview||draft)&&<button type="button" className="quiet" disabled={busy} onClick={()=>pick('none')}>Remove photo</button>}</div><p className="account-caption">JPG, PNG or WebP · up to 5 MB. We save a small square thumbnail.</p>{draft&&<div className="profile-photo-actions"><button type="button" disabled={busy||conflict} onClick={()=>void save()}>{busy?'Saving…':'Save photo'}</button><button type="button" className="quiet" disabled={busy} onClick={()=>{setDraft(null);setError('');setConflict(false);}}>Cancel</button></div>}{error&&<p role="alert" className="account-field-error">{error}{conflict&&<button type="button" className="quiet" disabled={busy} onClick={()=>void review()}>Reload saved photo</button>}</p>}{message&&<p role="status">{message}</p>}</section>;
}
