'use strict';

(() => {
    // Logging methods
    const logEvent = (message) => {
        if (true) {
            console.log(`${(new Date()).toISOString().split('T')[1]} - [EVENT] ${message}`);
        }
    };

    const logCommand = (message) => {
        if (true) {
            console.log(`${(new Date()).toISOString().split('T')[1]} - [COMMAND] ${message}`);
        }
    };

    const logDebug = (message, object) => {
        if (false) {
            console.log(`${(new Date()).toISOString().split('T')[1]} - [DEBUG] ***** ${message}` +
                `${object != undefined ? object.toString() : ''}`);
        }
    };

    // Helper utility methods
    const sortByDirection = (direction) => {
        return direction === 'up' ? (a, b) => a - b : (a, b) => b - a;
    }

    const filterByDirection = (currentFloor, direction) => {
        return direction === 'up' ?
            (floor) => floor >= currentFloor : (floor) => floor <= currentFloor;
    }

    const zip = (a, b, direction) => {
        return [...new Set(a.concat(b)).values()].sort(sortByDirection(direction));
    };
    
    // Classes
    class Elevator {
        #id
        #gameObject;
        #manager;
        #nextDirection;

        constructor(id, gameObject, manager) {
            this.#id = id;
            this.#gameObject = gameObject;
            this.#manager = manager;
            this.#nextDirection = 'up';
            this.#gameObject.on('idle', this.#idle.bind(this));
            this.#gameObject.on('floor_button_pressed', this.#buttonPressed.bind(this));
            this.#gameObject.on('passing_floor', this.#passingFloor.bind(this));
        }

        getId() {
            return this.#id;
        }

        getPassengerDestinations() {
            return this.#gameObject.getPressedFloors()
                .sort(sortByDirection(this.#nextDirection))
                .filter(filterByDirection(this.getCurrentFloor(), this.#nextDirection));
        }

        getIndicators() {
            return {
                up: this.#gameObject.goingUpIndicator(),
                down: this.#gameObject.goingDownIndicator()
            };
        }

        clearIndicators() {
            this.#gameObject.goingUpIndicator(false);
            this.#gameObject.goingDownIndicator(false);
        }

        getCurrentFloor() {
            return this.#gameObject.currentFloor();
        }

        hasDestination() {
            return this.#gameObject.destinationQueue.length > 0;
        }

        setDestination(floorNum, nextDirection) {
            this.#gameObject.destinationQueue[0] = floorNum;
            this.#gameObject.destinationQueue.length = 1;
            this.#gameObject.checkDestinationQueue();

            if (nextDirection == null) {
                this.clearIndicators();
                this.#nextDirection = floorNum > this.getCurrentFloor() ? 'up' : 'down';
            } else {
                this.#gameObject.goingUpIndicator(nextDirection === 'up');
                this.#gameObject.goingDownIndicator(nextDirection === 'down');
                this.#nextDirection = nextDirection;
            }

            logCommand(`elevator ${this.#id} sent to floor ${this.#gameObject.destinationQueue[0]}, ` +
                `indicating ${nextDirection}`);
        }

        getNextDirection() {
            return this.#nextDirection;
        }

        isFull() {
            return this.#gameObject.loadFactor() >= 0.55;
        }

        #idle() {
            logEvent(`elevator ${this.#id} is idle`);
            this.#manager.updateDestination(this.#id);
        }

        #buttonPressed(floorNum) {
            logEvent(`elevator ${this.#id} button pressed for floor ${floorNum}`);
            this.#manager.updateDestination(this.#id);
        }

        #passingFloor(floorNum, direction) {
            logEvent(`elevator ${this.#id} passing floor ${floorNum} going ${direction}`);
            this.#manager.checkIfShouldStop(this, floorNum, direction);
        }
    }

    class ElevatorManager {
        #elevators;
        #floorManager;

        constructor(elevatorGameObjects, floorManager) {
            this.#elevators = elevatorGameObjects.map((elevatorGameObject, i) => {
                const elevator = new Elevator(i, elevatorGameObject, this);
                elevatorGameObject.on('stopped_at_floor', floorManager.floorVisited(elevator));
                return elevator;
            });

            this.#floorManager = floorManager;
        }

        checkIfShouldStop(elevator, floorNum, direction) {
            const waitingSameDir = this.#floorManager.getWaitingPassengers(floorNum, direction, direction);
            if (waitingSameDir.length > 0 && waitingSameDir[0] === floorNum) {
                elevator.setDestination(floorNum, direction);
            }
        }

        updateDestination(id) {
            const elevator = this.#elevators[id];
            const nextDirection = elevator.getNextDirection();
            const oppDirection = nextDirection === 'up' ? 'down' : 'up';

            let [destinationFloor, destinationDirection] = this.#searchForDestination(elevator, nextDirection);

            // If we can't find a destination, try the other direction
            if (destinationFloor == null) {
                logDebug('no destination found, searching other direction');
                logDebug('');
                [destinationFloor, destinationDirection] = this.#searchForDestination(elevator, oppDirection);
            }

            // If we found a destination, set it
            if (destinationFloor != null) {
                elevator.setDestination(destinationFloor, destinationDirection);
            } // Otherwise, wait for a new button press (should only happen when there are no passengers anywhere)
            else {
                elevator.clearIndicators();
                this.#floorManager.onButtonPressed((floorNum, direction) => {
                    elevator.setDestination(floorNum, direction);
                });
                logDebug('no destination found, waiting for a button press');
            }
        }

        #searchForDestination(elevator, nextDirection) {
            const currentFloor = elevator.getCurrentFloor();
            const oppDirection = nextDirection === 'up' ? 'down' : 'up';

            const passengerDests = elevator.getPassengerDestinations();
            const waitingSameDir = this.#floorManager.getWaitingPassengers(currentFloor, nextDirection, nextDirection);
            const waitingOppDir = this.#floorManager.getWaitingPassengers(currentFloor, oppDirection, nextDirection);
            const allSameDir = zip(passengerDests, waitingSameDir, nextDirection);

            logDebug(`destination search initiated going ${nextDirection} from ${currentFloor}`);
            logDebug('  passenger destinations: ', passengerDests);
            logDebug('  same-direction waiting passengers: ', waitingSameDir);
            logDebug('    -all same-direction floors: ', allSameDir);
            logDebug('  opposite-direction waiting passengers: ', waitingOppDir);

            let destinationFloor = null;
            let destinationDirection = null;

            if (allSameDir.length > 0) {
                if (elevator.isFull()) {
                    destinationFloor = passengerDests[0];
                } else {
                    destinationFloor = allSameDir[0];
                }

                if (passengerDests.length === 1 && waitingSameDir.length === 0) {
                    if (this.#floorManager.anyWaitingPassengers()) {
                        destinationDirection = oppDirection;
                    }
                } else {
                    destinationDirection = nextDirection;
                }


            } else if (waitingOppDir.length > 0) {
                destinationFloor = waitingOppDir[waitingOppDir.length - 1];
                destinationDirection = oppDirection;
            }

            return [destinationFloor, destinationDirection];
        }

        getNumFloors() {
            return this.#floorManager.getNumFloors();
        }
    }

    class Floor {
        up;
        down;

        constructor() {
            this.up = false;
            this.down = false;
        }

        toString() {
            return `up: ${this.up}, down: ${this.down}`;
        }
    }

    class FloorManager {
        #floors;
        #elevatorManagerWaitingCallback;

        constructor(floorGameObjects) {
            this.#floors = floorGameObjects.map((floorGameObject, i) => {
                const id = floorGameObject.floorNum();
                if (id !== i) throw new Error(`Floor gameObjects out of order. floorNum=${id} i=${i}`);

                floorGameObject.on('up_button_pressed', this.#buttonPressed(id, 'up'));
                floorGameObject.on('down_button_pressed', this.#buttonPressed(id, 'down'));
                return new Floor();
            });

            this.#elevatorManagerWaitingCallback = null;
        }

        getNumFloors() {
            return this.#floors.length;
        }

        anyWaitingPassengers() {
            for (const floor of this.#floors) {
                if (floor.up === true || floor.down === true) {
                    return true;
                }
            }

            return false;
        }

        getWaitingPassengers(currentFloor, passengerDirection, elevatorDirection) {
            logDebug('    checking for waiting passengers:');
            this.#floors.forEach((floor, i) => logDebug(`      floor ${i}: `, floor));

            return this.#floors
                .map((floor, id) => floor[passengerDirection] === true ? id : null)
                .filter((floor) => floor != null)
                .filter(filterByDirection(currentFloor, elevatorDirection));
        }
        
        floorVisited(elevator) {
            return (floorNum) => {
                const floor = this.#floors[floorNum];

                if (elevator.getIndicators().up) {
                    floor.up = false;
                }

                if (elevator.getIndicators().down) {
                    floor.down = false;
                }

                logEvent(`floor ${floorNum} visited by elevator ${elevator.getId()}`);
                logDebug(`floor ${floorNum} buttons - up: ${floor.up}, down: ${floor.down}`);
            };
        }

        onButtonPressed(callback) {
            this.#elevatorManagerWaitingCallback = callback;
        }

        #buttonPressed(id, direction) {
            return () => {
                const floor = this.#floors[id];
                floor[direction] = true;
                logEvent(`floor ${id} ${direction} button pressed`);
                logDebug(`floor ${id} buttons - up: ${floor.up}, down: ${floor.down}`);
                
                if (this.#elevatorManagerWaitingCallback != null) {
                    this.#elevatorManagerWaitingCallback(id, direction);
                    this.#elevatorManagerWaitingCallback = null;
                }
            };
        }
    }
    
    return {
        init: (elevatorGameObjects, floorGameObjects) => {
            console.clear();
            const floorManager = new FloorManager(floorGameObjects);
            const elevatorManager = new ElevatorManager(elevatorGameObjects, floorManager);
        },
        update: (dt, elevators, floors) => {
        }
    };
})();
