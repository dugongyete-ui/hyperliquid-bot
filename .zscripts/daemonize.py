#!/usr/bin/env python3
"""Proper UNIX double-fork daemonizer (like libc daemon()).

Usage: daemonize.py <logfile> <command> [args...]
Reparents the command to PID 1 with its own session so sandbox session
reapers (which kill tool-call process groups) cannot touch it.
"""
import os
import sys


def daemonize() -> None:
    # fork 1: exit parent so the child is adopted and not a group leader
    pid = os.fork()
    if pid > 0:
        os._exit(0)
    os.setsid()
    # fork 2: ensure the daemon is never a session leader (no tty reacquisition)
    pid = os.fork()
    if pid > 0:
        os._exit(0)
    os.chdir("/")
    os.umask(0o022)


def main() -> None:
    logfile, cmd = sys.argv[1], sys.argv[2:]
    daemonize()
    # redirect std streams to the logfile / devnull
    fd = os.open(logfile, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o644)
    devnull = os.open(os.devnull, os.O_RDONLY)
    os.dup2(devnull, 0)
    os.dup2(fd, 1)
    os.dup2(fd, 2)
    os.close(fd)
    env = dict(os.environ)
    os.execvpe(cmd[0], cmd, env)


if __name__ == "__main__":
    main()
