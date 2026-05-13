import { createApp } from 'vue'
import App from './App.vue'
import router from './routes.js'  // make sure this matches your file name
import './assets/main.css'

const app = createApp(App)
app.use(router)  // This line is crucial
app.mount('#app')