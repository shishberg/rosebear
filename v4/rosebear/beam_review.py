"""Linear 3D beam screening. Isotropic surrogate, not laminate qualification/FEA.

Includes axial, two bending and torsional modes. Not suitable for predicting
root notch stress, delamination, damage, or large-deformation installed shape.
"""
import numpy as np
from scipy.sparse import lil_matrix
from scipy.sparse.linalg import spsolve


def solve(points, end_motion, width, thickness, E=20000., G=8000.):
    points=np.asarray(points,float);n=len(points);K=lil_matrix((6*n,6*n));elements=[]
    area=width*thickness;Iy=width*thickness**3/12;Iz=thickness*width**3/12
    a=max(width,thickness);b=min(width,thickness)
    J=a*b**3*(1/3-.21*b/a*(1-b**4/(12*a**4)))
    for i,(p,q) in enumerate(zip(points,points[1:])):
        L=np.linalg.norm(q-p);x=(q-p)/L;z=np.array([0.,0.,1.]);y=np.cross(z,x)
        R=np.array([x,y,z]);T=np.zeros((12,12))
        for j in range(4):T[3*j:3*j+3,3*j:3*j+3]=R
        k=np.zeros((12,12))
        for ids,c in [([0,6],E*area/L),([3,9],G*J/L)]:
            k[np.ix_(ids,ids)]+=c*np.array([[1,-1],[-1,1]])
        m=np.array([[12,6*L,-12,6*L],[6*L,4*L*L,-6*L,2*L*L],[-12,-6*L,12,-6*L],[6*L,2*L*L,-6*L,4*L*L]])
        k[np.ix_([1,5,7,11],[1,5,7,11])]+=E*Iz/L**3*m
        sign=np.diag([1,-1,1,-1]);k[np.ix_([2,4,8,10],[2,4,8,10])]+=E*Iy/L**3*(sign@m@sign)
        ids=np.arange(6*i,6*i+12);kg=T.T@k@T
        for r in range(12):
            for c in range(12):K[ids[r],ids[c]]+=kg[r,c]
        elements.append((ids,T,k,L))
    fixed=np.r_[np.arange(6),np.arange(6*n-6,6*n)];free=np.arange(6,6*n-6)
    u=np.zeros(6*n);u[-6:]=end_motion;K=K.tocsr()
    u[free]=spsolve(K[free,:][:,free],-K[free,:][:,fixed]@u[fixed])
    normal=[];shear=[]
    for ids,T,k,L in elements:
        force=k@T@u[ids]
        normal.append(max(abs(force[j])/E/area+abs(force[j+4])*thickness/(2*E*Iy)+abs(force[j+5])*width/(2*E*Iz) for j in [0,6]))
        shear.append(max(abs(force[j])*thickness/(G*J) for j in [3,9]))
    return {'max_normal_strain_percent':float(max(normal)*100),
            'torsion_shear_indicator_percent':float(max(shear)*100),
            'max_node_rotation_deg':float(np.max(np.linalg.norm(u.reshape(-1,6)[:,3:],axis=1))*180/np.pi),
            'deformed_points':(points+u.reshape(-1,6)[:,:3]).tolist(),
            'normal_strain_percent_by_element':(np.array(normal)*100).tolist()}
