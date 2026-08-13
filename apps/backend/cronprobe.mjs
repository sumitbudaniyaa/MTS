import cron from 'node-cron';
let fired = 0;
const t = cron.schedule('* * * * * *', () => { fired++; });  // every second
setTimeout(() => {
  console.log(`without .start(): fired ${fired} times in 3s`);
  if (fired === 0) {
    t.start();
    setTimeout(() => console.log(`after .start(): fired ${fired} times`), 3000);
  }
}, 3000);
