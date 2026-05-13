
import { createRouter, createWebHistory } from 'vue-router'
import Home from './components/Home.vue'
import Invite from './components/Invite.vue'
import Stats from './components/Stats.vue'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/',
      name: 'home',
      component: Home
    },
    {
      path: '/invite/:name',
      name: 'invite',
      component: Invite,
      props: true
    },
    {
      path: '/stats',
      name: 'stats',
      component: Stats
    }
  ]
})

export default router