import { contextBridge, ipcRenderer } from 'electron'
import { FRAME_IPC, type FrameInfo } from '../main/calls/ipc'

// The call window's bar may only end the call, minimise the window and hear what to show.
contextBridge.exposeInMainWorld('callFrame', {
  end: () => ipcRenderer.send(FRAME_IPC.end),
  minimize: () => ipcRenderer.send(FRAME_IPC.minimize),
  onState: (handler: (info: FrameInfo) => void) => {
    ipcRenderer.on(FRAME_IPC.state, (_event, info: FrameInfo) => handler(info))
  }
})
