import { create } from 'zustand'

export const useAppStore = create((set) => ({
  activeDatasetId: null,
  activeTaskId: null,
  taskProgress: 0,
  taskMessage: '',
  taskStatus: '',
  taskStep: '',
  taskSub: {},

  setActiveDataset: (id) => set({ activeDatasetId: id }),
  
  setTaskProgress: (activeTaskId, taskProgress, taskMessage, taskStatus, taskStep = '', taskSub = {}) =>
    set({ activeTaskId, taskProgress, taskMessage, taskStatus, taskStep, taskSub }),
    
  clearTask: () => set({
    activeTaskId: null,
    taskProgress: 0,
    taskMessage: '',
    taskStatus: '',
    taskStep: '',
    taskSub: {}
  }),
}))
