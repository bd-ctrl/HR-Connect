// Keep existing home-screen apps working without showing an installation UI.
document.querySelectorAll('#install-app, #install-dialog').forEach(element=>element.remove());
window.addEventListener('beforeinstallprompt',event=>event.preventDefault());
if('serviceWorker' in navigator)navigator.serviceWorker.register('./sw.js',{updateViaCache:'none'}).catch(()=>{});
