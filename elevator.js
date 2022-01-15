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
        if (true) {
            console.log(`${(new Date()).toISOString().split('T')[1]} - [DEBUG] ${message}` +
                `${object != undefined ? object.toString() : ''}`);
        }
    };

    // Helper utility methods
    const sortByDirection = (direction) => {
        return direction === 'up' ? (a, b) => a - b : (a, b) => b - a;
    }

    const filterByDirection = (currentFloor, direction) => {
        return direction === 'up' ?
            (floor) => floor > currentFloor : (floor) => floor < currentFloor;
    }

    const zip = (a, b, direction) => {
        const result = [];

        if (direction === 'down') {
            a.reverse();
            b.reverse();
        }

        let i = 0, j = 0;

        while (i < a.length && j < b.length) {
            if (a[i] === b[i]) {
                result.push(a[i++]);
                j++;
            } else if (a[i] < b[i]) {
                result.push(a[i++]);
            } else if (a[i] > b[i]) {
                result.push(b[j++]);
            }
        }

        while (i < a.length) {
            result.push(a[i++]);
        }

        while (j < b.length) {
            result.push(b[j++]);
        }

        return direction === 'down' ? result.reverse() : result;
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
            this.#gameObject.on('idle', this.#idle.bind(this));
            this.#gameObject.on('floor_button_pressed', this.#buttonPressed.bind(this));
            this.#gameObject.on('passing_floor', this.#passingFloor.bind(this));
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

            this.#gameObject.goingUpIndicator(nextDirection === 'up');
            this.#gameObject.goingDownIndicator(nextDirection === 'down');
            this.#nextDirection = nextDirection;

            logCommand(`elevator ${this.#id} sent to floor ${this.#gameObject.destinationQueue[0]}, ` +
                `indicating ${nextDirection}`);
        }

        getNextDirection() {
            return this.#nextDirection;
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
        }
    }

    class ElevatorManager {
        #elevators;
        #floorManager;

        constructor(elevatorGameObjects, floorManager) {
            this.#elevators = elevatorGameObjects.map((elevatorGameObject, i) => {
                const elevator = new Elevator(i, elevatorGameObject, this);
                elevatorGameObject.on('stopped_at_floor', floorManager.floorVisited(i, elevator.getIndicators()));
                return elevator;
            });

            this.#floorManager = floorManager;
        }

        updateDestination(id) {
            const elevator = this.#elevators[id];
            const currentFloor = elevator.getCurrentFloor();
            const nextDirection = elevator.getNextDirection();
            const oppDirection = nextDirection === 'up' ? 'down' : 'up';

            // Search for a destination
            const passengerDests = elevator.getPassengerDestinations();
            const waitingSameDir = this.#floorManager.getWaitingPassengers(currentFloor, nextDirection);
            const waitingOppDir = this.#floorManager.getWaitingPassengers(currentFloor, oppDirection);

            const allSameDir = zip(passengerDests, waitingSameDir, nextDirection);

            logDebug('*** destination search initiated ***');
            logDebug('passenger destinations: ', passengerDests);
            logDebug('same-direction waiting passengers: ', waitingSameDir);
            logDebug(' -all same-direction floors: ', allSameDir);
            logDebug('opposite-direction waiting passengers: ', waitingOppDir);

            // If we found a destination, go to it
            if (allSameDir.length > 0) {
                elevator.setDestination(allSameDir[0], nextDirection);
            } else if (waitingOppDir.length > 0) {
                elevator.setDestination(waitingOppDir[waitingOppDir.length - 1], oppDirection);
            } // Otherwise, wait for a button to be pressed
            else {
                elevator.clearIndicators();
                this.#floorManager.onButtonPressed((floorNum, direction) => {
                    elevator.setDestination(floorNum, direction);
                });
                logDebug('*** no destination found, waiting for a button press ***');
            }
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

        getWaitingPassengers(currentFloor, direction) {
            return this.#floors
                .map((floor, id) => floor[direction] === true ? id : null)
                .filter((floor) => floor != null)
                .filter(filterByDirection(currentFloor, direction));
        }
        
        floorVisited(i, indicators) {
            return (floorNum) => {
                const floor = this.#floors[floorNum];
                floor.up = !indicators.up;
                floor.down = !indicators.down;
                logEvent(`floor ${floorNum} visited by elevator ${i}, ` +
                    `up: ${floor.up}, down: ${floor.down}`);
            };
        }

        onButtonPressed(callback) {
            this.#elevatorManagerWaitingCallback = callback;
        }

        #buttonPressed(id, direction) {
            return () => {
                const floor = this.#floors[id];
                floor[direction] = true;
                logEvent(`floor ${id} ${direction} button pressed, ` +
                    `up: ${floor.up}, down: ${floor.down}`);
                
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
