let installPrompt=null;
const installButton=document.querySelector('#install-app'),installDialog=document.querySelector('#install-dialog');
const standalone=()=>matchMedia('(display-mode: standalone)').matches||navigator.standalone===true;
function syncInstall(){installButton.hidden=standalone();}
syncInstall();matchMedia('(display-mode: standalone)').addEventListener('change',syncInstall);
installButton.addEventListener('click',()=>installDialog.showModal());
document.querySelector('#close-install').addEventListener('click',()=>installDialog.close());
installDialog.addEventListener('click',e=>{if(e.target===installDialog){const r=installDialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)installDialog.close();}});
window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();installPrompt=e;document.querySelector('#native-install-wrap').hidden=false;});
document.querySelector('#native-install').addEventListener('click',async()=>{if(!installPrompt)return;const p=installPrompt;installPrompt=null;await p.prompt();const choice=await p.userChoice;if(choice.outcome==='accepted')installDialog.close();document.querySelector('#native-install-wrap').hidden=true;});
window.addEventListener('appinstalled',()=>{installButton.hidden=true;installDialog.close();});
if('serviceWorker' in navigator)navigator.serviceWorker.register('./sw.js',{updateViaCache:'none'}).catch(()=>{/* Browser may restrict workers; manual home-screen instructions remain available. */});
