// Public HTML is identical for everyone. Account-aware links are updated privately.
fetch('/api/v1/auth/session', {cache:'no-store',credentials:'same-origin'})
  .then(r=>r.ok?r.json():null).then(result=>{
    if (!result?.data?.user) return;
    // The primary header action is sufficient once signed in.
    document.querySelector('.session-link')?.setAttribute('hidden', '');
    document.querySelectorAll('a[href="/auth"], a[href="/auth?next=%2Fapp%2Ftoday"]').forEach(link=>{
      link.setAttribute('href','/app/today');
      const text=[...link.childNodes].find(node=>node.nodeType===Node.TEXT_NODE && node.textContent.trim());
      if(text)text.textContent='Open workspace ';
    });
  }).catch(()=>{});
