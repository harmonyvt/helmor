use std::sync::{mpsc, Mutex};

use tauri::ipc::Channel;

use super::events::UiMutationEvent;

#[derive(Default)]
pub struct UiSyncManager {
    subscribers: Mutex<Vec<Channel<UiMutationEvent>>>,
    remote_subscribers: Mutex<Vec<mpsc::Sender<UiMutationEvent>>>,
}

impl UiSyncManager {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn subscribe(&self, channel: Channel<UiMutationEvent>) {
        if let Ok(mut subscribers) = self.subscribers.lock() {
            subscribers.push(channel);
        }
    }

    pub fn publish(&self, event: UiMutationEvent) {
        let Ok(mut subscribers) = self.subscribers.lock() else {
            return;
        };

        subscribers.retain(|channel| channel.send(event.clone()).is_ok());
        drop(subscribers);

        let Ok(mut remote_subscribers) = self.remote_subscribers.lock() else {
            return;
        };
        remote_subscribers.retain(|sender| sender.send(event.clone()).is_ok());
    }

    pub fn subscribe_remote(&self) -> mpsc::Receiver<UiMutationEvent> {
        let (sender, receiver) = mpsc::channel();
        if let Ok(mut subscribers) = self.remote_subscribers.lock() {
            subscribers.push(sender);
        }
        receiver
    }

    #[cfg(test)]
    pub(super) fn subscriber_count(&self) -> usize {
        self.subscribers.lock().map(|s| s.len()).unwrap_or(0)
    }

    #[cfg(test)]
    pub(super) fn remote_subscriber_count(&self) -> usize {
        self.remote_subscribers.lock().map(|s| s.len()).unwrap_or(0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn new_manager_starts_with_no_subscribers() {
        let manager = UiSyncManager::new();
        assert_eq!(manager.subscriber_count(), 0);
    }

    #[test]
    fn publish_with_no_subscribers_is_a_noop() {
        let manager = UiSyncManager::new();
        manager.publish(UiMutationEvent::WorkspaceListChanged);
        assert_eq!(manager.subscriber_count(), 0);
    }

    #[test]
    fn default_manager_matches_new() {
        let default_manager = UiSyncManager::default();
        let new_manager = UiSyncManager::new();
        assert_eq!(
            default_manager.subscriber_count(),
            new_manager.subscriber_count()
        );
    }

    #[test]
    fn remote_subscriber_receives_published_events() {
        let manager = UiSyncManager::new();
        let rx = manager.subscribe_remote();
        assert_eq!(manager.remote_subscriber_count(), 1);

        manager.publish(UiMutationEvent::WorkspaceListChanged);

        assert_eq!(rx.recv().unwrap(), UiMutationEvent::WorkspaceListChanged);
    }
}
