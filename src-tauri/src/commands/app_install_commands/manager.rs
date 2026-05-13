use std::sync::{Arc, Mutex};

use anyhow::bail;

#[derive(Default)]
pub struct AppInstallManager {
    current: Mutex<Option<Arc<AppInstallRunState>>>,
}

impl AppInstallManager {
    pub fn new() -> Self {
        Self::default()
    }

    pub(super) fn begin(&self) -> anyhow::Result<Arc<AppInstallRunState>> {
        let mut current = self.current.lock().expect("app install manager poisoned");
        if current.is_some() {
            bail!("A Helmor update is already running");
        }
        let state = Arc::new(AppInstallRunState::default());
        *current = Some(state.clone());
        Ok(state)
    }

    pub(super) fn finish(&self, state: &Arc<AppInstallRunState>) {
        let mut current = self.current.lock().expect("app install manager poisoned");
        if current
            .as_ref()
            .map(|candidate| Arc::ptr_eq(candidate, state))
            .unwrap_or(false)
        {
            *current = None;
        }
    }

    pub(super) fn cancel(&self) -> bool {
        let current = self
            .current
            .lock()
            .expect("app install manager poisoned")
            .clone();
        let Some(state) = current else {
            return false;
        };
        state.cancel();
        true
    }
}

#[derive(Default)]
pub(super) struct AppInstallRunState {
    cancelled: std::sync::atomic::AtomicBool,
    child_pid: Mutex<Option<u32>>,
}

impl AppInstallRunState {
    fn cancel(&self) {
        self.cancelled
            .store(true, std::sync::atomic::Ordering::SeqCst);
        if let Some(pid) = *self.child_pid.lock().expect("app install state poisoned") {
            kill_process_group(pid);
        }
    }

    pub(super) fn check_cancelled(&self) -> anyhow::Result<()> {
        if self.cancelled.load(std::sync::atomic::Ordering::SeqCst) {
            bail!("Helmor update cancelled");
        }
        Ok(())
    }

    pub(super) fn set_child_pid(&self, pid: Option<u32>) {
        *self.child_pid.lock().expect("app install state poisoned") = pid;
    }
}

fn kill_process_group(pid: u32) {
    unsafe {
        libc::kill(-(pid as libc::pid_t), libc::SIGKILL);
    }
}
