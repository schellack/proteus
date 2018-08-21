#!/usr/bin/env python3

"""
Runs appveyor test daemon
"""

from os import environ
from appveyor_test import AppveyorTest

PLATFORM = environ["PARTICLE_PLATFORM"] or "electron" 

TESTER = AppveyorTest(PLATFORM)
TESTER.add_test("unit_tests_1")
TESTER.add_test("integration_test")
TESTER.add_test("smoke_test")
TESTER.add_test("unit_tests_3")

#TESTER.enable_destructive_tests(True)
TESTER.add_destructive_test("NAND_Write_test")
TESTER.add_destructive_test("stress_test")
    
TESTER.add_scenario("unexpected_powercycle")
TESTER.add_scenario("disconnect_wifi")
TESTER.run()
