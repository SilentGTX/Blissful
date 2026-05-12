import { ToastQueue } from '@heroui/react';

export const notificationQueue = new ToastQueue({ maxVisibleToasts: 2 });
export const errorQueue = new ToastQueue({ maxVisibleToasts: 3 });
export const successQueue = new ToastQueue({ maxVisibleToasts: 2 });

export function notifyError(title: string, description: string) {
  errorQueue.add({
    title,
    description,
    variant: 'danger',
  });
}

export function notifyInfo(title: string, description: string) {
  notificationQueue.add({
    title,
    description,
    variant: 'default',
  });
}

export function notifySuccess(title: string, description: string) {
  successQueue.add({
    title,
    description,
    variant: 'success',
  });
}
