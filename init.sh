#!/usr/bin/bash

# Configure cmake build.
echo Configuring cmake build...
export CFLAGS="-O2 -flto=1 -ftree-parallelize-loops=4 -floop-parallelize-all -fopenmp"
export CXXFLAGS="-O2 -flto=1 -ftree-parallelize-loops=4 -floop-parallelize-all -fopenmp"
export LDFLAGS="-O2 -flto=1 -ftree-parallelize-loops=4 -floop-parallelize-all -fopenmp"
mkdir build
cd build
cmake ..
cd ..

