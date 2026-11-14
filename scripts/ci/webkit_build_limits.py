"""Bounded research build policy; reserve time for installation and native PDF tests."""
COMPILE_MAX_SECONDS = 310 * 60
OPERATION_MAX_SECONDS = 350 * 60
ACCEPTANCE_RESERVE_SECONDS = 35 * 60
MIN_START_SECONDS = 30 * 60
MEMORY_RESERVE_BYTES = 2 * 1024**3
DISK_RESERVE_BYTES = 4 * 1024**3
NO_PROGRESS_SECONDS = 30 * 60


def compile_budget(operation_elapsed):
    if operation_elapsed < 0:
        raise ValueError('Operation clock moved backwards')
    remaining = min(COMPILE_MAX_SECONDS, OPERATION_MAX_SECONDS - operation_elapsed - ACCEPTANCE_RESERVE_SECONDS)
    if remaining < MIN_START_SECONDS:
        raise RuntimeError('Insufficient bounded compile time while retaining native acceptance reserve')
    return remaining


def stop_reason(elapsed, budget, available_memory, free_disk, since_progress):
    if free_disk < DISK_RESERVE_BYTES:
        return 'disk reserve below 4 GiB'
    if available_memory < MEMORY_RESERVE_BYTES:
        return 'MemAvailable below 2 GiB'
    if elapsed >= budget:
        return 'bounded compile/link budget reached; native acceptance reserve retained'
    if since_progress >= NO_PROGRESS_SECONDS:
        return 'no Ninja completion for 30 minutes'
    return None
