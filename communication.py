#!/usr/bin/env python3

"""
This module opens a serial port on a thread.
All processing is done on other threads using concurrent queues.
This decouples any processing latency from reading the port,
reducing the probability of dropping serial messages.
"""
from os import path
from queue import Queue, Empty
from threading import Thread, Event
from serial import SerialException, Serial


class Channel():
    """ A generic buffered channel using concurrent queues """

    TIMEOUT = 60

    def __init__(self):
        # Paradigm: GET from input (stdin)
        self.input = Queue()
        # Paradigm: PUT into output (stdout)
        self.output = Queue()
        self.thread = None

    def alive(self):
        """ Is the channel currently open """
        return self.thread is not None and self.thread.alive()

    def close(self):
        """ Closes the channel """
        self.clear()
        if self.thread is None:
            return
        self.thread.stop()
        self.thread.join()
        self.thread = None

    def open(self):
        """ Opens the channel """
        if self.thread is None:
            self.thread = LoopbackThread(self.input, self.output)
            self.thread.start()
        return True

    def clear(self):
        """ Clears input and output queues """
        while not self.input.empty():
            try:
                self.input.get(False)
            except Empty:
                continue
            self.input.task_done()
        while not self.output.empty():
            try:
                self.output.get(False)
            except Empty:
                continue
            self.output.task_done()

    @staticmethod
    def factory(config):
        """ Constructs a channel based on config """
        if config.get('Host', 'platform') == 'test':
            return Channel()
        return SerialChannel(config)


class SerialChannel(Channel):
    """ A channel using configured TTY serial """

    BAUD = 115200

    def __init__(self, config):
        super().__init__()
        self.device = None
        self.config = config

    def open(self):
        """ Open the serial device """
        if self.alive():
            return True
        port = self.config.get('Host', 'serial_port')
        if not path.exists(port):
            print("Port {} does not exist".format(port))
            return False
        try:
            self.device = Serial(
                port,
                self.BAUD,
                timeout=self.TIMEOUT)
            self.thread = SerialThread(self.device, self.input, self.output)
            self.thread.start()
            return True
        except SerialException as ser_ex:
            print("SerialException: {}".format(str(ser_ex)))
            return False
        except IOError as io_ex:
            print("IOError: {}".format(str(io_ex)))
            return False

    def close(self):
        """ Stops thread and closes device """
        self.clear()
        if self.thread:
            self.thread.stop()
            self.thread.join()
        if self.device:
            self.device.close()
        self.device = None

    def alive(self):
        """ Checks if device and thread are still alive """
        return self.device is not None and self.thread.alive()


class NewlineChannel(SerialChannel):
    """ Only puts data in the queue after a newline """

    def __init__(self, config):
        super().__init__(config)
        self.raw_queue = Queue()
        self.newline_detector = None

    def open(self):
        """ Open the serial device """
        if self.alive():
            return True
        if not path.exists(self.config.get('Host', 'serial_port')):
            return False
        try:
            self.device = Serial(
                self.config.get('Host', 'serial_port'),
                self.BAUD,
                timeout=self.TIMEOUT)
            self.thread = SerialThread(self.device, self.raw_queue, self.output)
            self.newline_detector = NewlineThread(self.input, self.raw_queue)
            self.thread.start()
            self.newline_detector.start()
            return True
        except SerialException as ser_ex:
            print("SerialException: {}".format(str(ser_ex)))
            return False
        except IOError as io_ex:
            print("IOError: {}".format(str(io_ex)))
            return False

    def alive(self):
        """ Checks if everything is open and in good state """
        if self.device is None:
            return False
        if self.thread is None or self.newline_detector is None:
            return False
        return self.thread.alive() and self.newline_detector.alive()

    def close(self):
        """ Cleans up threads and devices """
        self.clear()
        if self.thread:
            self.thread.stop()
            self.thread.join()
        if self.newline_detector:
            self.newline_detector.stop()
            self.newline_detector.join()
        if self.device:
            self.device.close()
        self.device = None

    @staticmethod
    def factory(config):
        if config.get('Host', 'platform') == 'test':
            return Channel()
        return NewlineChannel(config)


class StopSignalThread(Thread):
    """ A thread that uses the stop() method to halt """
    def __init__(self):
        super().__init__()
        self._req_stop = Event()

    def run(self):
        """ Runs the thread until stop is set """
        while not self._req_stop.is_set():
            self.exec()  # pylint: disable=E1101

    def stop(self):
        """ Signals the thread to stop """
        self._req_stop.set()

    def alive(self):
        """ Returns true if thread is actively running, false otherwise """
        return not self._req_stop.is_set()


class LoopbackThread(StopSignalThread):
    """
    Loops back any input to the output. Use for testing channel
    and thread APIs.
    """
    def __init__(self, input_queue, output_queue):
        super().__init__()
        self.input = input_queue
        self.output = output_queue

    def exec(self):
        """ Loops input """
        if not self.output.empty():
            self.input.put(self.output.get())
            self.output.task_done()


class SerialThread(StopSignalThread):
    """ Reads from a serial port as fast as possible """
    def __init__(self, conn, input_queue, output_queue):
        super().__init__()
        self.connection = conn
        self.input_queue = input_queue
        self.output_queue = output_queue

    def exec(self):
        """ Runs the thread """
        try:
            if not self.output_queue.empty():
                self.connection.write(self.output_queue.get())
                self.output_queue.task_done()
            self.input_queue.put(
                self.connection.read(
                    max(1,
                        self.connection.inWaiting())))
        except SerialException as ser_ex:
            print("SerialException: {}".format(str(ser_ex)))
            self.stop()
            return
        except IOError as io_ex:
            print("IOError: {}".format(str(io_ex)))
            self.stop()
            return


class NewlineThread(StopSignalThread):
    """ Checks an incoming byte stream for newlines """
    def __init__(self, input_queue, output_queue, ending=b"\r\n"):
        super().__init__()
        self.buffer = bytearray()
        self.line_end = ending
        self.input_queue = input_queue
        self.output_queue = output_queue

    def exec(self):
        """ Runs the thread """
        if not self.output_queue.empty():
            newbytes = self.output_queue.get()
            self.output_queue.task_done()
            self.getline(newbytes)

    def getline(self, newbytes):
        """ Look for a newline in the data queue """
        self.buffer.extend(newbytes)
        chunks = self.buffer.split(self.line_end)
        for line in chunks[:-1]:
            self.input_queue.put(line.decode("utf-8"))
        self.buffer[0:] = chunks[-1]
