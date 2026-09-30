import { createApp } from 'vue';
import { createRouter, createWebHistory } from 'vue-router';
import App from './App.vue';
import OverviewView from './views/OverviewView.vue';
import HolesView from './views/HolesView.vue';
import HoleDetailView from './views/HoleDetailView.vue';
import ProfileView from './views/ProfileView.vue';
import TimeSeriesView from './views/TimeSeriesView.vue';
import MeasurementView from './views/MeasurementView.vue';
import ProbesView from './views/ProbesView.vue';
import './styles.css';

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', component: OverviewView },
    { path: '/holes', component: HolesView },
    { path: '/holes/:id', component: HoleDetailView, props: true },
    { path: '/holes/:id/profile', component: ProfileView, props: true },
    { path: '/holes/:id/time-series', component: TimeSeriesView, props: true },
    { path: '/measurements/:id', component: MeasurementView, props: true },
    { path: '/probes', component: ProbesView },
  ],
});

createApp(App).use(router).mount('#app');
