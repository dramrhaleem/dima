'use client';
import { useState } from 'react';
import './avatar.css';
/** Decorative identity image: the adjacent display name remains the accessible label. */
export function Avatar({name,src,size='medium',className=''}:{name:string;src?:string|null;size?:'small'|'medium'|'large';className?:string}) {
 const [failed,setFailed]=useState<string|null>(null);
 const safe=src&&(/^\/api\/v1\/profiles\/[a-f0-9-]+\/avatar(?:\?v=\d+)?$/i.test(src)||/^data:image\/jpeg;base64,[A-Za-z0-9+/]+=*$/.test(src)||/^https:\/\/(?:[a-z0-9-]+\.)?googleusercontent\.com\//.test(src));
 return <span className={`dima-avatar dima-avatar-${size} ${className}`} aria-hidden="true">{safe&&src!==failed?<img src={src} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={()=>setFailed(src)}/>:Array.from(name.trim())[0]?.toLocaleUpperCase()||'D'}</span>;
}
