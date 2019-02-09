import { Platform, Subscription } from 'expo-core';

import {
  Base64,
  Central,
  CentralState,
  CharacteristicProperty,
  Identifier,
  NativeAdvertismentData,
  NativeBluetoothElement,
  NativeCharacteristic,
  NativeDescriptor,
  NativeError,
  NativeEventData,
  NativePeripheral,
  NativeService,
  PeripheralFoundCallback,
  PeripheralState,
  ScanSettings,
  StateUpdatedCallback,
  TransactionId,
  TransactionType,
  UUID,
  WriteCharacteristicOptions,
} from './Bluetooth.types';
import { BLUETOOTH_EVENT, DELIMINATOR, EVENTS, TYPES } from './BluetoothConstants';
import {
  addHandlerForKey,
  addListener,
  fireMultiEventHandlers,
  firePeripheralObservers,
  getHandlersForKey,
  resetHandlersForKey,
  _resetAllHandlers,
} from './BluetoothEventHandler';
import { invariantAvailability, invariantUUID } from './BluetoothInvariant';
import { clearPeripherals, getPeripherals, updateStateWithPeripheral } from './BluetoothLocalState';
import { peripheralIdFromId } from './BluetoothTransactions';
import ExpoBluetooth from './ExpoBluetooth';
import Transaction from './Transaction';

import BluetoothError from './BluetoothError';

export * from './Bluetooth.types';

/*
initializeManagerAsync
deallocateManagerAsync

getPeripheralsAsync
getCentralAsync
startScanningAsync
stopScanningAsync
connectPeripheralAsync
readRSSIAsync
readDescriptorAsync
writeDescriptorAsync
writeCharacteristicAsync
readCharacteristicAsync
setNotifyCharacteristicAsync

discoverDescriptorsForCharacteristicAsync
discoverCharacteristicsForServiceAsync
discoverIncludedServicesForServiceAsync
disconnectPeripheralAsync
*/
export { BLUETOOTH_EVENT, TYPES, EVENTS };

type ScanOptions = {
  serviceUUIDsToQuery?: string[];
  androidScanMode?: any;
  androidMatchMode?: any;
  /**
   * Match as many advertisement per filter as hw could allow
   * dependes on current capability and availability of the resources in hw.
   */
  androidNumberOfMatches?: any;
};

type CancelScanningCallback = () => void;
/**
 * **iOS:**
 *
 * Although strongly discouraged,
 * if `serviceUUIDsToQuery` is `null | undefined` all discovered peripherals will be returned.
 * If the central is already scanning with different
 * `serviceUUIDsToQuery` or `scanSettings`, the provided parameters will replace them.
 */
export function startScan(
  scanSettings: ScanOptions = {},
  callback: (peripheral: NativePeripheral) => void
): CancelScanningCallback {
  invariantAvailability('startScanningAsync');
  const { serviceUUIDsToQuery = [], ...scanningOptions } = scanSettings;

  ExpoBluetooth.startScanningAsync([...new Set(serviceUUIDsToQuery)], scanningOptions);

  const subscription = addHandlerForKey(
    EVENTS.CENTRAL_DID_DISCOVER_PERIPHERAL,
    (event) => {
      if (!event) {
        throw new Error("UNEXPECTED " + EVENTS.CENTRAL_DID_DISCOVER_PERIPHERAL);
      }
      callback(event.peripheral);
    }
  );

  return async () => {
    subscription.remove();
    await stopScanAsync();
  };
}

export async function stopScanAsync(): Promise<void> {
  invariantAvailability('stopScanningAsync');
  // Remove all callbacks
  await resetHandlersForKey(EVENTS.CENTRAL_DID_DISCOVER_PERIPHERAL);
  await ExpoBluetooth.stopScanningAsync();
}

// Avoiding using "start" in passive method names
export function observeUpdates(callback: (updates: any) => void): Subscription {
  return addHandlerForKey('everything', callback);
}

export async function observeStateAsync(callback: StateUpdatedCallback): Promise<Subscription> {
  const central = await getCentralAsync();
  // Make the callback async so the subscription returns first.
  setTimeout(() => callback(central.state));
  return addHandlerForKey(EVENTS.CENTRAL_DID_UPDATE_STATE, callback);
}

export async function connectAsync(
  peripheralUUID: UUID,
  options: {
    timeout?: number;
    options?: any;
    onDisconnect?: any;
  } = {}
): Promise<NativePeripheral> {
  invariantAvailability('connectPeripheralAsync');
  invariantUUID(peripheralUUID);

  const { onDisconnect } = options;
  if (onDisconnect) {
    addHandlerForKey(EVENTS.CENTRAL_DID_DISCONNECT_PERIPHERAL, onDisconnect);
  }

  let timeoutTag: number | undefined;

  return new Promise(async (resolve, reject) => {
    if (options.timeout) {
      timeoutTag = setTimeout(() => {
        disconnectAsync(peripheralUUID);
        reject(
          new BluetoothError({
            message: `Failed to connect to peripheral: ${peripheralUUID} in under: ${
              options.timeout
            }ms`,
            code: 'timeout',
          })
        );
      }, options.timeout);
    }

    let result;
    try {
      result = await ExpoBluetooth.connectPeripheralAsync(peripheralUUID, options.options);
    } catch (error) {
      reject(error);
    } finally {
      clearTimeout(timeoutTag);
    }
    resolve(result);
  });
}

export async function disconnectAsync(peripheralUUID: UUID): Promise<any> {
  invariantAvailability('disconnectPeripheralAsync');
  invariantUUID(peripheralUUID);
  return await ExpoBluetooth.disconnectPeripheralAsync(peripheralUUID);
}

/* TODO: Bacon: Add a return type */
export async function readDescriptorAsync({
  peripheralUUID,
  serviceUUID,
  characteristicUUID,
  descriptorUUID,
}: any): Promise<Base64 | undefined> {
  const { descriptor } = await ExpoBluetooth.readDescriptorAsync({
    peripheralUUID,
    serviceUUID,
    characteristicUUID,
    descriptorUUID,
    characteristicProperties: CharacteristicProperty.Read,
  });

  return descriptor.value;
}

/* TODO: Bacon: Add a return type */
export async function writeDescriptorAsync({
  peripheralUUID,
  serviceUUID,
  characteristicUUID,
  descriptorUUID,
  data,
}: any): Promise<any> {
  invariantAvailability('writeDescriptorAsync');
  const { descriptor } = await ExpoBluetooth.writeDescriptorAsync({
    peripheralUUID,
    serviceUUID,
    characteristicUUID,
    descriptorUUID,
    data,
    characteristicProperties: CharacteristicProperty.Write,
  });
  return descriptor;
}
export async function shouldNotifyDescriptorAsync({
  peripheralUUID,
  serviceUUID,
  characteristicUUID,
  descriptorUUID,
  shouldNotify,
}: any): Promise<any> {
  invariantAvailability('setNotifyCharacteristicAsync');

  const { descriptor } = await ExpoBluetooth.setNotifyCharacteristicAsync({
    peripheralUUID,
    serviceUUID,
    characteristicUUID,
    descriptorUUID,
    shouldNotify,
  });
  return descriptor;
}

/* TODO: Bacon: Add a return type */
export async function readCharacteristicAsync({
  peripheralUUID,
  serviceUUID,
  characteristicUUID,
}: any): Promise<Base64 | null> {
  const { characteristic } = await ExpoBluetooth.readCharacteristicAsync({
    peripheralUUID,
    serviceUUID,
    characteristicUUID,
    characteristicProperties: CharacteristicProperty.Read,
  });

  return characteristic.value;
}

/* TODO: Bacon: Add a return type */
export async function writeCharacteristicAsync({
  peripheralUUID,
  serviceUUID,
  characteristicUUID,
  data,
}: any): Promise<NativeCharacteristic> {
  const { characteristic } = await ExpoBluetooth.writeCharacteristicAsync({
    peripheralUUID,
    serviceUUID,
    characteristicUUID,
    data,
    characteristicProperties: CharacteristicProperty.Write,
  });
  return characteristic;
}

/* TODO: Bacon: Why would anyone use this? */
/* TODO: Bacon: Test if this works */
/* TODO: Bacon: Add a return type */
export async function writeCharacteristicWithoutResponseAsync({
  peripheralUUID,
  serviceUUID,
  characteristicUUID,
  data,
}: WriteCharacteristicOptions): Promise<NativeCharacteristic> {
  const { characteristic } = await ExpoBluetooth.writeCharacteristicAsync({
    peripheralUUID,
    serviceUUID,
    characteristicUUID,
    data,
    characteristicProperties: CharacteristicProperty.WriteWithoutResponse,
  });
  return characteristic;
}

export async function readRSSIAsync(peripheralUUID: UUID): Promise<number> {
  invariantAvailability('readRSSIAsync');
  invariantUUID(peripheralUUID);
  return await ExpoBluetooth.readRSSIAsync(peripheralUUID);
}

export async function getPeripheralsAsync(): Promise<any[]> {
  invariantAvailability('getPeripheralsAsync');
  return await ExpoBluetooth.getPeripheralsAsync();
}

export async function getCentralAsync(): Promise<any> {
  invariantAvailability('getCentralAsync');
  return await ExpoBluetooth.getCentralAsync();
}

export async function isScanningAsync(): Promise<any> {
  const { isScanning } = await getCentralAsync();
  return isScanning;
}

// TODO: Bacon: Add serviceUUIDs
export async function discoverServicesForPeripheralAsync(options: {
  id: string;
  serviceUUIDs?: UUID[];
  characteristicProperties?: CharacteristicProperty;
}): Promise<{ peripheral: NativePeripheral }> {
  invariantAvailability('discoverServicesForPeripheralAsync');
  const transaction = Transaction.fromTransactionId(options.id);
  return await ExpoBluetooth.discoverServicesForPeripheralAsync({
    ...transaction.getUUIDs(),
    serviceUUIDs: options.serviceUUIDs,
    characteristicProperties: options.characteristicProperties,
  });
}

export async function discoverIncludedServicesForServiceAsync(options: {
  id: string;
  serviceUUIDs?: UUID[];
}): Promise<{ peripheral: NativePeripheral }> {
  invariantAvailability('discoverIncludedServicesForServiceAsync');
  const transaction = Transaction.fromTransactionId(options.id);
  return await ExpoBluetooth.discoverIncludedServicesForServiceAsync({
    ...transaction.getUUIDs(),
    serviceUUIDs: options.serviceUUIDs,
  });
}

export async function discoverCharacteristicsForServiceAsync(options: {
  id: string;
  serviceUUIDs?: UUID[];
  characteristicProperties?: CharacteristicProperty;
}): Promise<{ service: NativeService }> {
  invariantAvailability('discoverCharacteristicsForServiceAsync');
  const transaction = Transaction.fromTransactionId(options.id);
  return await ExpoBluetooth.discoverCharacteristicsForServiceAsync({
    ...transaction.getUUIDs(),
    serviceUUIDs: options.serviceUUIDs,
    characteristicProperties: options.characteristicProperties,
  });
}

export async function discoverDescriptorsForCharacteristicAsync(options: {
  id: string;
  serviceUUIDs?: UUID[];
  characteristicProperties?: CharacteristicProperty;
}): Promise<{ peripheral: NativePeripheral; characteristic: NativeCharacteristic }> {
  invariantAvailability('discoverDescriptorsForCharacteristicAsync');
  const transaction = Transaction.fromTransactionId(options.id);
  return await ExpoBluetooth.discoverDescriptorsForCharacteristicAsync({
    ...transaction.getUUIDs(),
    serviceUUIDs: options.serviceUUIDs,
    characteristicProperties: options.characteristicProperties,
  });
  // return await discoverAsync({ id });
}

export async function loadPeripheralAsync(
  { id },
  skipConnecting: boolean = false
): Promise<NativePeripheral> {
  const peripheralId = peripheralIdFromId(id);
  const peripheral = getPeripherals()[peripheralId];
  if (!peripheral) {
    throw new Error('Not a peripheral ' + peripheralId);
  }

  if (peripheral.state !== 'connected') {
    if (!skipConnecting) {
      const connectedPeripheral = await connectAsync(peripheralId, {
        onDisconnect: (...props) => {
          console.log('On Disconnect public callback', ...props);
        },
      });
      console.log('loadPeripheralAsync(): connected!');
      return loadPeripheralAsync(connectedPeripheral, true);
    } else {
      // This should never be called because in theory connectAsync would throw an error.
    }
  } else if (peripheral.state === 'connected') {
    console.log('loadPeripheralAsync(): _loadChildrenRecursivelyAsync!');
    await _loadChildrenRecursivelyAsync({ id: peripheralId });
  }

  // In case any updates occured during this function.
  return getPeripherals()[peripheralId];
}

export async function _loadChildrenRecursivelyAsync({ id }): Promise<any[]> {
  const components = id.split(DELIMINATOR);
  console.log({ components });
  if (components.length === 4) {
    // Descriptor ID
    throw new Error('Descriptors have no children');
  } else if (components.length === 3) {
    // Characteristic ID
    console.log('Load Characteristic ', id);
    // DEBUG

    // console.warn('DISABLE ME');
    // return [];
    const {
      characteristic: { descriptors },
    } = await discoverDescriptorsForCharacteristicAsync({ id });
    return descriptors;
  } else if (components.length === 2) {
    // Service ID
    console.log('Load Service ', id);
    const { service } = await discoverCharacteristicsForServiceAsync({ id });
    console.log('LOADED CHARACTERISTICS FROM SERVICE', service);
    return await Promise.all(
      service.characteristics.map(characteristic => _loadChildrenRecursivelyAsync(characteristic))
    );
  } else if (components.length === 1) {
    // Peripheral ID
    console.log('Load Peripheral ', id);
    const {
      peripheral: { services },
    } = await discoverServicesForPeripheralAsync({ id });
    return await Promise.all(services.map(service => _loadChildrenRecursivelyAsync(service)));
  } else {
    throw new Error(`Unknown ID ${id}`);
  }
}

export async function getConnectedPeripheralsAsync(
  serviceUUIDsToQuery: UUID[] = []
): Promise<NativePeripheral[]> {
  invariantAvailability('getConnectedPeripheralsAsync');
  return await ExpoBluetooth.getConnectedPeripheralsAsync(serviceUUIDsToQuery);
}

const android = {
  async requestMTUAsync(peripheralUUID: UUID, MTU: number): Promise<number> {
    invariantAvailability('requestMTUAsync');
    invariantUUID(peripheralUUID);
    return await ExpoBluetooth.requestMTUAsync(peripheralUUID, MTU);
  },
  async createBondAsync(peripheralUUID: UUID): Promise<any> {
    invariantAvailability('createBondAsync');
    invariantUUID(peripheralUUID);
    return await ExpoBluetooth.createBondAsync(peripheralUUID);
  },
  async removeBondAsync(peripheralUUID: UUID): Promise<any> {
    invariantAvailability('removeBondAsync');
    invariantUUID(peripheralUUID);
    return await ExpoBluetooth.removeBondAsync(peripheralUUID);
  },
  async enableBluetoothAsync(isBluetoothEnabled: boolean): Promise<void> {
    invariantAvailability('enableBluetoothAsync');
    return await ExpoBluetooth.enableBluetoothAsync(isBluetoothEnabled);
  },
  async getBondedPeripheralsAsync(): Promise<NativePeripheral[]> {
    invariantAvailability('getBondedPeripheralsAsync');
    return await ExpoBluetooth.getBondedPeripheralsAsync();
  },
  async requestConnectionPriorityAsync(
    peripheralUUID: UUID,
    connectionPriority: number
  ): Promise<any> {
    invariantAvailability('requestConnectionPriorityAsync');
    invariantUUID(peripheralUUID);
    return await ExpoBluetooth.requestConnectionPriorityAsync(peripheralUUID, connectionPriority);
  },
  async clearCacheForPeripheralAsync(peripheralUUID: UUID): Promise<boolean> {
    invariantAvailability('clearCacheForPeripheralAsync');
    invariantUUID(peripheralUUID);
    return await ExpoBluetooth.clearCacheForPeripheralAsync(peripheralUUID);
  },
  observeBluetoothAvailabilty(callback: (updates: Central) => void): Subscription {
    return addHandlerForKey(EVENTS.ENABLE_BLUETOOTH, callback);
  },
};

export { android };

export async function _reset(): Promise<void> {
  await stopScanAsync();
  clearPeripherals();
  await _resetAllHandlers();
}

addListener(({ data, event }: { data: NativeEventData; event: string }) => {
  const { transactionId, peripheral, peripherals, central, advertisementData, RSSI, error } = data;

  // console.log('GOT EVENT: ', { data, event });
  if (event === 'UPDATE') {
    clearPeripherals();
    if (peripherals) {
      for (const peripheral of peripherals) {
        updateStateWithPeripheral(peripheral);
      }
    }
    firePeripheralObservers();
    return;
  }

  switch (event) {
    case EVENTS.CENTRAL_DID_DISCONNECT_PERIPHERAL:
    case EVENTS.CENTRAL_DID_DISCOVER_PERIPHERAL:
      fireMultiEventHandlers(event, { peripheral });
      firePeripheralObservers();
      return;
    case EVENTS.CENTRAL_DID_UPDATE_STATE:
      if (!central) {
        throw new Error('EXBluetooth: Central not defined while processing: ' + event);
      }

      for (const callback of getHandlersForKey(event)) {
        callback(central.state);
      }

      return;
    case EVENTS.CENTRAL_DID_RETRIEVE_CONNECTED_PERIPHERALS:
    case EVENTS.CENTRAL_DID_RETRIEVE_PERIPHERALS:
      return;
    case EVENTS.ENABLE_BLUETOOTH:
      fireMultiEventHandlers(event, { central });
      return;
    default:
      throw new Error('EXBluetooth: Unhandled event: ' + event);
  }
});
