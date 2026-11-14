'use strict';
const {contextBridge, ipcRenderer} = require('electron');
contextBridge.exposeInMainWorld('sampleApp', Object.freeze({
  voiceStatus: () => ipcRenderer.invoke('sample:voice:status'),
  stopAnnouncements: () => ipcRenderer.invoke('sample:voice:stop'),
  announceApproach: id => ipcRenderer.invoke('sample:voice:approach',id),
  transit: () => ipcRenderer.invoke('sample:transit:snapshot'),
  mapStops: () => ipcRenderer.invoke('sample:transit:map-stops'),
  vehicleShape: id => ipcRenderer.invoke('sample:transit:vehicle-shape',id),
  vehicleDetails: id => ipcRenderer.invoke('sample:transit:vehicle',id),
  routeShapes: id => ipcRenderer.invoke('sample:transit:shapes',id),
  routes: () => ipcRenderer.invoke('sample:transit:routes'),
  stops: query => ipcRenderer.invoke('sample:transit:stops',query),
  departures: id => ipcRenderer.invoke('sample:transit:departures',id),
  weather: () => ipcRenderer.invoke('sample:weather'),
  cityInfo: () => ipcRenderer.invoke('sample:city-info'),
  cityMap: () => ipcRenderer.invoke('sample:city-map'),
  powerOutages: () => ipcRenderer.invoke('sample:power-outages'),
  viaLive: () => ipcRenderer.invoke('sample:via-live'),
  scooters: () => ipcRenderer.invoke('sample:scooters'),
  cityPowerUpdates: () => ipcRenderer.invoke('sample:city-power-updates'),
  serviceHours: () => ipcRenderer.invoke('sample:service-hours'),
  print: () => ipcRenderer.invoke('sample:print'),
  status: () => ipcRenderer.invoke('sample:status'),
  time: () => ipcRenderer.invoke('sample:time'),
  paper: () => ipcRenderer.invoke('sample:paper:get'),
  openLink: key => ipcRenderer.invoke('sample:open-link', key),
  plan: request => ipcRenderer.invoke('sample:plan', request),
  setPaper: id => ipcRenderer.invoke('sample:paper:set', id)
}));

