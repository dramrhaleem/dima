'use client';
import { useEffect, useRef, useState } from 'react';
import './account-operations.css';

type DeletionState={requestId:string;status:'codeSent'|'pending'|'failed'|'done';expiresAt?:string;retryable?:boolean};
const messageFor=(code:string)=>({EMAIL_DELIVERY_UNAVAILABLE:'We could not send the verification email. Please try again later.',CONFIRMED_EMAIL_REQUIRED:'Confirm an email address on your account before requesting deletion.',CODE_INVALID:'That code is invalid or expired. Check the email and try again.',CODE_EXPIRED:'This verification has expired. Request a new code.',CODE_RESTART_REQUIRED:'Request a new verification code to continue.',RATE_LIMITED:'Please wait a minute before requesting another code.',EXPORT_TOO_LARGE:'Your account exceeds the current download limit. Contact support to arrange a complete export.',ACCOUNT_CHANGED:'Your account changed. Reload Settings before continuing.',AUTH_REQUIRED:'Please sign in again before continuing.'}[code]??'We could not finish this request. Your account has not been confirmed deleted. Please try again.');
export function AccountOperations({accountId}:{accountId:string}){return <AccountOperationsForActor key={accountId} accountId={accountId}/>;}
function AccountOperationsForActor({accountId}:{accountId:string}){
 const [busy,setBusy]=useState<'export'|'delete'|null>(null),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [open,setOpen]=useState(false),[deletion,setDeletion]=useState<DeletionState|null>(null),[code,setCode]=useState(''),[confirmation,setConfirmation]=useState('');
 const mounted=useRef(true);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 const current=(owner:string)=>mounted.current&&accountId===owner;
 async function download(){
  const owner=accountId;setBusy('export');setError('');setNotice('');
  try{
   const response=await fetch('/api/v1/account/export',{cache:'no-store',credentials:'same-origin',headers:{'X-Dima-Account-Id':owner},signal:AbortSignal.timeout(30000)});
   if(!response.ok){const payload=await response.json();throw new Error(payload?.error?.code??'EXPORT_FAILED');}
   const blob=await response.blob();if(!current(owner))return;
   const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=`dima-account-${new Date().toISOString().slice(0,10)}.json`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);setNotice('Your download has been requested. If it didn’t start, try Download JSON again.');
  }catch(error){if(current(owner))setError(error instanceof Error && ['EXPORT_TOO_LARGE','ACCOUNT_CHANGED','AUTH_REQUIRED','RATE_LIMITED'].includes(error.message) ? messageFor(error.message) : 'We couldn’t download your data. Check your connection and try again.');}finally{if(current(owner))setBusy(null);}
 }
 async function remove(type:'start'|'confirm'|'retry'){
  const owner=accountId;setBusy('delete');setError('');setNotice('');
  try{
   const body=type==='start'?{type,operationId:crypto.randomUUID()}:{type,requestId:deletion?.requestId,confirmation,...(type==='confirm'?{code}: {})};
   const response=await fetch('/api/v1/account/deletion',{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json','X-Dima-Account-Id':owner},body:JSON.stringify(body),signal:AbortSignal.timeout(45000)});
   const payload=await response.json();if(!current(owner))return;
   if(payload.data?.status==='failed'){setDeletion(payload.data);setError('Deletion is pending because the final account cleanup failed. Your account is hidden and changes are paused. Retry to finish.');return;}
   if(!response.ok)throw new Error(payload?.error?.code??'DELETE_FAILED');
   setDeletion(payload.data);
   if(payload.data.status==='done'){
    setNotice('Your account has been deleted.');
    if(typeof BroadcastChannel!=='undefined'){const channel=new BroadcastChannel('dima-account');channel.postMessage('signout-pending');channel.close();}
    window.location.assign('/auth');
   }else setNotice('Enter the new code sent to your account email. This code is valid for 10 minutes.');
  }catch(error){if(current(owner)){
   if(deletion?.requestId){try{const status=await fetch(`/api/v1/account/deletion?requestId=${encodeURIComponent(deletion.requestId)}`,{credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(10000)}).then(r=>r.json());if(current(owner)&&status.data?.status==='done'){window.location.assign('/auth');return;}}catch{/* Keep the original error and offer a safe retry. */}}
   setError(messageFor(error instanceof Error?error.message:''));
  }}finally{if(current(owner))setBusy(null);}
 }
 return <section className="account-operations" aria-labelledby="account-data-title">
  <div><p className="account-data-eyebrow">Your data, your choice</p><h2 id="account-data-title">Account &amp; data</h2><p>Keep a copy of your work, or permanently close your Dima account.</p></div>
  <div className="account-data-row"><div><h3>Download your data</h3><p>A JSON copy of your profile, learning plans, time history, sharing settings and contributions. It contains your private information; store it somewhere safe.</p></div><button type="button" disabled={!!busy} onClick={()=>void download()}>{busy==='export'?'Preparing…':'Download JSON'}</button></div>
  <div className="account-data-row account-delete-row"><div><h3>Delete account</h3><p>Permanently removes your account and private records. Published course outlines may remain in the public library without your account identity.</p></div><button type="button" className="account-delete-open" disabled={!!busy} onClick={()=>setOpen(!open)} aria-expanded={open}>{open?(deletion?.status==='failed'||deletion?.status==='pending'?'Hide deletion details':'Cancel'):(deletion?.status==='failed'||deletion?.status==='pending'?'View deletion status':'Delete account')}</button></div>
  {open&&<div className="account-delete-confirm"><h3>Confirm permanent deletion</h3><p>Your plans, progress, focus history and connections will be removed. Rooms you own will close. Download your data first if you need a copy.</p>
   {!deletion||deletion.status==='done'?<button type="button" disabled={!!busy} onClick={()=>void remove('start')}>{busy==='delete'?'Sending…':'Email a verification code'}</button>:<>
    {deletion.status==='codeSent'&&<label>Email verification code<input disabled={!!busy} value={code} onChange={event=>setCode(event.target.value.replace(/\D/g,'').slice(0,10))} autoComplete="one-time-code" inputMode="numeric" maxLength={10}/></label>}
    <label>Type DELETE to confirm<input disabled={!!busy} value={confirmation} onChange={event=>setConfirmation(event.target.value)} autoComplete="off" spellCheck={false}/></label>
    <div className="account-delete-actions"><button type="button" className="account-delete-final" disabled={!!busy||confirmation!=='DELETE'||(deletion.status==='codeSent'&&!/^\d{6,10}$/.test(code))} onClick={()=>void remove(deletion.status==='codeSent'?'confirm':'retry')}>{busy==='delete'?'Deleting…':deletion.status==='failed'?'Retry account deletion':'Permanently delete account'}</button>{deletion.status==='codeSent'&&<button type="button" disabled={!!busy} onClick={()=>void remove('start')}>Request new code</button>}</div>
   </>}
  </div>}
  {error&&<p className="account-data-error" role="alert">{error}</p>}{notice&&<p className="account-data-notice" role="status">{notice}</p>}
 </section>;
}
